// controllers/purchase.js
import mongoose from 'mongoose';
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import { sendFcmToTokens } from '../utils/fcm.js';
import sendEmail from '../utils/sendMail.js';

/**
 * Normalize an array (or single) of user identifiers which may contain:
 * - ObjectId
 * - string id
 * - Mongoose document / plain object with _id
 *
 * Returns an array of valid string ids only.
 */
function normalizeUserIds(input = []) {
  if (!Array.isArray(input)) input = [input];
  const ids = input
    .map((v) => {
      if (!v) return null;

      // If it's a Mongoose document or plain object with _id
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        // If it's an ObjectId instance
        if (
          v.constructor &&
          (v.constructor.name === 'ObjectID' ||
            v.constructor.name === 'ObjectId')
        )
          return String(v);
        return null;
      }

      // primitive (string or number)
      return String(v);
    })
    .filter(Boolean);

  // keep only valid ObjectId strings
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
}

/**
 * gather FCM tokens for an array of userIds (deduped)
 */
async function gatherTokensForUserIds(userIds = []) {
  const ids = normalizeUserIds(userIds);
  if (!ids.length) return [];

  const uniqueIds = Array.from(new Set(ids));
  const users = await User.find({ _id: { $in: uniqueIds } })
    .select('fcmTokens name')
    .lean();
  const tokens = users.flatMap((u) =>
    Array.isArray(u.fcmTokens) ? u.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
}

/**
 * Gather emails (and names) for given user ids (deduped).
 * Returns array of { email, name }.
 */
async function gatherEmailsForUserIds(userIds = []) {
  const ids = normalizeUserIds(userIds);
  if (!ids.length) return [];

  const uniqueIds = Array.from(new Set(ids));
  const users = await User.find({ _id: { $in: uniqueIds } })
    .select('email name')
    .lean();

  const list = users
    .map((u) =>
      u && u.email ? { email: String(u.email), name: u.name || '' } : null
    )
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const item of list) {
    if (!seen.has(item.email)) {
      seen.add(item.email);
      unique.push(item);
    }
  }
  return unique;
}

/**
 * Gather admin emails.
 */
async function gatherAdminEmails() {
  const admins = await User.find({ role: 'admin' }).select('email name').lean();
  const list = admins
    .map((a) =>
      a && a.email ? { email: String(a.email), name: a.name || '' } : null
    )
    .filter(Boolean);
  const seen = new Set();
  const unique = [];
  for (const item of list) {
    if (!seen.has(item.email)) {
      seen.add(item.email);
      unique.push(item);
    }
  }
  return unique;
}

/**
 * Send emails to list of { email, name } recipients, concurrently.
 * Returns summary { sent, failed, failures }.
 */
async function sendEmailsToRecipients(recipients = [], subject, body) {
  if (!recipients || !recipients.length)
    return { sent: 0, failed: 0, failures: [] };

  if (typeof sendEmail !== 'function') {
    console.error(
      'sendEmail is not a function - check utils/sendMail.js export'
    );
    return {
      sent: 0,
      failed: recipients.length,
      failures: recipients.map((r) => ({
        email: r.email,
        error: 'sendEmail missing',
      })),
    };
  }

  const promises = recipients.map((r) =>
    sendEmail({ email: r.email, subject, body })
      .then(() => ({ email: r.email, ok: true }))
      .catch((err) => ({
        email: r.email,
        ok: false,
        error: err.message || String(err),
      }))
  );

  const results = await Promise.allSettled(promises);
  const failures = [];
  let sent = 0;
  for (const res of results) {
    if (res.status === 'fulfilled' && res.value && res.value.ok) sent++;
    else {
      const info = (res.status === 'fulfilled' ? res.value : res.reason) || {};
      failures.push(info);
    }
  }
  return { sent, failed: failures.length, failures };
}

/**
 * notify all admins helper (sends FCM and email)
 */
async function notifyAdmins(
  title,
  body,
  data = {},
  emailSubject = null,
  emailBody = null
) {
  try {
    const adminDocs = await User.find({ role: 'admin' }).select('_id').lean();
    const adminIds = adminDocs.map((a) => a._id).filter(Boolean);
    if (adminIds.length) {
      const tokens = await gatherTokensForUserIds(adminIds);
      if (tokens.length) await sendFcmToTokens(tokens, { title, body }, data);
    }

    if (emailSubject && emailBody) {
      const adminEmails = await gatherAdminEmails();
      if (adminEmails.length)
        await sendEmailsToRecipients(adminEmails, emailSubject, emailBody);
    }
  } catch (err) {
    console.error('notifyAdmins error:', err);
  }
}

/**
 * Build a small purchase summary for notifications/emails (sanitizes fields).
 */
function purchaseSummaryForNotify(purchaseDoc = {}) {
  const requestedBy = purchaseDoc.requestedBy || {};
  const requiredBy = purchaseDoc.requiredBy || {};
  return {
    assetName: purchaseDoc.assetName || 'Asset',
    quantity: purchaseDoc.quantity || purchaseDoc.qty || 1,
    requestedByName: requestedBy.name || '—',
    requestedByEmail: requestedBy.email || '—',
    requiredByName: requiredBy.name || '—',
    requiredByEmail: requiredBy.email || '—',
    status: purchaseDoc.status || 'Pending',
    date: purchaseDoc.createdAt
      ? new Date(purchaseDoc.createdAt).toLocaleString('en-IN')
      : new Date().toLocaleString('en-IN'),
  };
}

/**
 * @desc   Create Purchase Request
 * @route  POST /api/v1/purchase
 * @access Private
 */
export const createRequest = asyncHandler(async (req, res, next) => {
  const create = await Purchase.create(req.body);

  // populate for convenience (requiredBy, requestedBy)
  await create.populate('requiredBy requestedBy', 'name email role');

  // Build recipients list
  try {
    const userIds = [];
    if (create.requiredBy) userIds.push(create.requiredBy);
    if (create.requestedBy) userIds.push(create.requestedBy);

    const tokens = await gatherTokensForUserIds(userIds);
    const title = 'New Purchase Request';
    const body = `${create.assetName || 'Purchase request'} created by ${
      create.requestedBy?.name || 'user'
    }`;
    const data = {
      type: 'purchase:create' /* avoid exposing IDs in FCM payload */,
    };

    if (tokens.length) {
      try {
        await sendFcmToTokens(tokens, { title, body }, data);
      } catch (err) {
        console.error('FCM error on createRequest (users):', err);
      }
    } else {
      console.log(
        'createRequest: no tokens found for involved users',
        normalizeUserIds(userIds)
      );
    }

    // Email to involved users
    const emailRecipients = await gatherEmailsForUserIds(userIds);
    const summary = purchaseSummaryForNotify(create);
    if (emailRecipients.length) {
      const subject = 'TAGit — New Purchase Request';
      const emailBody = `
Hello ${summary.requiredByName},

A new purchase request has been created.

Asset: ${summary.assetName}
Quantity: ${summary.quantity}
Requested By: ${summary.requestedByName} (${summary.requestedByEmail})
Requested For: ${summary.requiredByName} (${summary.requiredByEmail})
Status: ${summary.status}
Date: ${summary.date}

Regards,
TAGit
      `;
      const emailRes = await sendEmailsToRecipients(
        emailRecipients,
        subject,
        emailBody
      );
      if (emailRes.failed)
        console.warn('createRequest email failures (users)', emailRes.failures);
      else console.log(`createRequest Emails sent: ${emailRes.sent}`);
    }

    // Notify admins via FCM and email
    const adminTitle = 'New Purchase Request';
    const adminBody = `${create.assetName || 'Purchase request'} created`;
    const adminEmailSubject = 'TAGit — New Purchase Request';
    const adminEmailBody = `
Hello Admin,

A new purchase request has been created.

Asset: ${summary.assetName}
Quantity: ${summary.quantity}
Requested By: ${summary.requestedByName} (${summary.requestedByEmail})
Requested For: ${summary.requiredByName} (${summary.requiredByEmail})
Status: ${summary.status}
Date: ${summary.date}

Regards,
TAGit
    `;
    await notifyAdmins(
      adminTitle,
      adminBody,
      { type: 'purchase:create' },
      adminEmailSubject,
      adminEmailBody
    );
  } catch (err) {
    console.error('FCM/Email error on createRequest:', err);
  }

  res.status(201).json({
    success: true,
    data: create,
  });
});

/**
 * @desc    Update Purchase Request
 * @route   PUT /api/v1/purchase/:id
 * @access  Private
 */
export const updateRequest = asyncHandler(async (req, res, next) => {
  let request = await Purchase.findById(req.params.id);
  if (!request) {
    return next(
      new ErrorResponse(`Request does not exist with ID ${req.params.id}`, 404)
    );
  }

  request = await Purchase.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('requiredBy requestedBy', 'name email role');

  // Notify users and admins
  try {
    const userIds = [];
    if (request.requiredBy) userIds.push(request.requiredBy);
    if (request.requestedBy) userIds.push(request.requestedBy);

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'Purchase Request Updated';
      const body = `Purchase request "${
        request.assetName || ''
      }" has been updated`;
      const data = { type: 'purchase:update' };
      try {
        await sendFcmToTokens(tokens, { title, body }, data);
      } catch (err) {
        console.error('FCM error on updateRequest (users):', err);
      }
    } else {
      console.log(
        'updateRequest: no tokens found for involved users',
        normalizeUserIds(userIds)
      );
    }

    // Emails to involved users
    const emailRecipients = await gatherEmailsForUserIds(userIds);
    const summary = purchaseSummaryForNotify(request);
    if (emailRecipients.length) {
      const subject = 'TAGit — Purchase Request Updated';
      const emailBody = `
Hello ${summary.requiredByName},

A purchase request has been updated.

Asset: ${summary.assetName}
Quantity: ${summary.quantity}
Requested By: ${summary.requestedByName} (${summary.requestedByEmail})
Requested For: ${summary.requiredByName} (${summary.requiredByEmail})
Status: ${summary.status}
Date: ${summary.date}

Regards,
TAGit
      `;
      const emailRes = await sendEmailsToRecipients(
        emailRecipients,
        subject,
        emailBody
      );
      if (emailRes.failed)
        console.warn('updateRequest email failures (users)', emailRes.failures);
      else console.log(`updateRequest Emails sent: ${emailRes.sent}`);
    }

    // Notify admins
    const adminTitle = 'Purchase Request Updated';
    const adminBody = `${request.assetName || 'Purchase request'} was updated`;
    const adminEmailSubject = 'TAGit — Purchase Request Updated';
    const adminEmailBody = `
Hello Admin,

A purchase request has been updated.

Asset: ${summary.assetName}
Quantity: ${summary.quantity}
Requested By: ${summary.requestedByName} (${summary.requestedByEmail})
Requested For: ${summary.requiredByName} (${summary.requiredByEmail})
Status: ${summary.status}
Date: ${summary.date}

Regards,
TAGit
    `;
    await notifyAdmins(
      adminTitle,
      adminBody,
      { type: 'purchase:update' },
      adminEmailSubject,
      adminEmailBody
    );
  } catch (err) {
    console.error('FCM/Email error on updateRequest:', err);
  }

  res.status(200).json({
    success: true,
    data: request,
  });
});

/**
 * @desc    Get Request List according to userId
 * @route   GET /api/v1/purchase/:id
 * @access  Private
 */
export const getRequests = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  const request = await Purchase.find({
    $or: [{ requiredBy: userId }, { requestedBy: userId }],
  }).populate('requiredBy requestedBy', 'name email role');

  res.status(200).json({
    success: true,
    data: request,
  });
});

/**
 * @desc    Get All Purchase Requests
 * @route   GET /api/v1/purchase
 * @access  Private
 */
export const getAllRequests = asyncHandler(async (req, res, next) => {
  const request = await Purchase.find().populate(
    'requiredBy requestedBy',
    'name email role'
  );
  res.status(200).json({
    success: true,
    data: request,
  });
});
