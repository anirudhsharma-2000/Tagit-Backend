// controllers/allocation.js
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Allocation from '../models/Allocation.js';
import Asset from '../models/Asset.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { sendFcmToTokens } from '../utils/fcm.js';
import sendEmail from '../utils/sendMail.js';

const allocationPopulate = [
  { path: 'allocatedBy', select: 'name email role' },
  { path: 'allocatedTo', select: 'name email role' },
  {
    path: 'asset',
    select: 'name serialNo owner purchaser photoUrl invoiceUrl',
    populate: [
      { path: 'owner', select: 'name email role' },
      { path: 'purchaser', select: 'name email role' },
    ],
  },
];

/**
 * Helper to validate ObjectId
 */
function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

/**
 * Normalize messy user id inputs to an array of ObjectId strings.
 */
function normalizeUserIds(input = []) {
  if (!Array.isArray(input)) input = [input];

  const ids = input
    .map((v) => {
      if (!v) return null;

      // If it's a mongoose document or plain object
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        if (v.id) return String(v.id);
        return null;
      }

      if (typeof v === 'string') {
        const s = v.trim();
        if (mongoose.Types.ObjectId.isValid(s)) return s;
        try {
          const parsed = JSON.parse(s);
          if (parsed && (parsed._id || parsed.id)) {
            const maybe = String(parsed._id || parsed.id);
            if (mongoose.Types.ObjectId.isValid(maybe)) return maybe;
          }
        } catch (_) {}
        const oidMatch = s.match(/ObjectId\(['"`]?([a-fA-F0-9]{24})['"`]?\)/);
        if (oidMatch && oidMatch[1]) return oidMatch[1];
        const hexMatch = s.match(
          /_id[^:]*[:=][^'"\dA-Fa-f]*['"`]?([a-fA-F0-9]{24})['"`]?/
        );
        if (hexMatch && hexMatch[1]) return hexMatch[1];
        return null;
      }

      const asStr = String(v);
      if (mongoose.Types.ObjectId.isValid(asStr)) return asStr;
      return null;
    })
    .filter(Boolean);

  const unique = Array.from(new Set(ids));
  return unique.filter((id) => mongoose.Types.ObjectId.isValid(id));
}

/**
 * Gather FCM tokens for given user identifiers (ids, docs, or messy strings).
 * Returns deduped array of token strings.
 */
export async function gatherTokensForUserIds(userIds = []) {
  const ids = normalizeUserIds(userIds);
  if (!ids.length) return [];

  const users = await User.find({ _id: { $in: ids } })
    .select('fcmTokens name')
    .lean();
  const tokens = users.flatMap((u) =>
    Array.isArray(u.fcmTokens) ? u.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
}

/**
 * Gather emails (and optionally names) for given user identifiers.
 * Returns array of { email, name } objects (deduped).
 */
export async function gatherEmailsForUserIds(userIds = []) {
  const ids = normalizeUserIds(userIds);
  if (!ids.length) return [];

  const users = await User.find({ _id: { $in: ids } })
    .select('email name')
    .lean();

  const list = users
    .map((u) => {
      if (!u || !u.email) return null;
      return { email: String(u.email), name: u.name || '' };
    })
    .filter(Boolean);

  // dedupe by email
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

  // ensure sendEmail is a function
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
    sendEmail({
      email: r.email,
      subject,
      body,
    })
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
 * Return a small, safe summary object for an allocation to use in notifications/emails.
 * DOES NOT expose the raw allocationId.
 */
function allocationSummaryForNotify(allocationDoc = {}) {
  const asset = allocationDoc.asset || {};
  const allocatedTo = allocationDoc.allocatedTo || {};
  const allocatedBy = allocationDoc.allocatedBy || {};

  return {
    assetName: asset.name || 'Unknown asset',
    assetSerial: asset.serialNo || asset.serial || '',
    allocationType: allocationDoc.allocationType || 'Allocation',
    status: allocationDoc.status || '',
    requestedFrom: allocatedBy.name || '—',
    requestedFromEmail: allocatedBy.email || '—',
    requestedTo: allocatedTo.name || '—',
    requestedToEmail: allocatedTo.email || '—',
    date: allocationDoc.allocationStatusDate
      ? new Date(allocationDoc.allocationStatusDate).toLocaleString('en-IN')
      : allocationDoc.createdAt
      ? new Date(allocationDoc.createdAt).toLocaleString('en-IN')
      : new Date().toLocaleString('en-IN'),
  };
}

/**
 * @desc    Create Allocation
 * @route   POST /api/v1/allocation
 * @access  Private
 */
export const createAllocation = asyncHandler(async (req, res, next) => {
  const create = await Allocation.create(req.body);

  // If the allocation references an asset, set that asset's `allocation` field
  if (create.asset) {
    try {
      await Asset.findByIdAndUpdate(
        create.asset,
        { allocation: create._id },
        { new: true }
      );
    } catch (err) {
      console.error(
        'Failed to set asset.allocation after allocation create:',
        err
      );
    }
  }

  // Build recipient user ids (allocatedTo, allocatedBy, plus asset owner/purchaser)
  try {
    const userIds = [];
    if (create.allocatedTo) userIds.push(create.allocatedTo);
    if (create.allocatedBy) userIds.push(create.allocatedBy);
    if (create.asset) {
      const asset = await Asset.findById(create.asset).select(
        'owner purchaser'
      );
      if (asset?.owner) userIds.push(asset.owner);
      if (asset?.purchaser) userIds.push(asset.purchaser);
    }

    // get populated allocation so we can include names, asset details
    const populatedCreate = await Allocation.findById(create._id).populate(
      allocationPopulate
    );
    const summary = allocationSummaryForNotify(populatedCreate || create);

    // FCM
    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'New Allocation Request';
      const body = `A new allocation has been created for "${summary.assetName}" (S/N: ${summary.assetSerial}) from ${summary.requestedFrom} to ${summary.requestedTo}.`;
      const data = {
        type: 'allocation:create',
        allocation: summary,
      };
      try {
        const fcmRes = await sendFcmToTokens(tokens, { title, body }, data);
        console.log('FCM createAllocation result', fcmRes);
      } catch (err) {
        console.error('FCM error createAllocation:', err);
      }
    }

    // Emails
    const emailRecipients = await gatherEmailsForUserIds(userIds);
    if (emailRecipients.length) {
      const subject = 'TAGit — New Allocation Request';
      const emailBody = `
Hello ${summary.requestedTo},

A new device allocation request has been created.

Asset: ${summary.assetName}
Serial No: ${summary.assetSerial}
Requested From: ${summary.requestedFrom} (${summary.requestedFromEmail})
Requested To: ${summary.requestedTo} (${summary.requestedToEmail})
Status: ${summary.status || 'Pending'}
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
        console.warn('Email createAllocation failures', emailRes.failures);
      else console.log(`Emails sent: ${emailRes.sent}`);
    }
  } catch (err) {
    console.error('FCM/Email error on createAllocation:', err);
  }

  const populated = await Allocation.findById(create._id).populate(
    allocationPopulate
  );
  res.status(201).json({
    success: true,
    data: populated,
  });
});

/**
 * @desc    Get All Allocations
 * @route   GET /api/v1/allocation
 * @access  Private
 */
export const getAllocations = asyncHandler(async (req, res, next) => {
  const allocations = await Allocation.find().populate(allocationPopulate);
  res.status(200).json({
    success: true,
    data: allocations,
  });
});

/**
 * @desc    Get Allocation By id
 * @route   GET /api/v1/allocation/:id
 * @access  Private
 */
export const getAllocationById = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id))
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));

  const allocation = await Allocation.findById(id).populate(allocationPopulate);
  if (!allocation)
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));

  res.status(200).json({ success: true, data: allocation });
});

/**
 * @desc    Get Allocations By User id (allocatedTo OR allocatedBy)
 * @route   GET /api/v1/allocation/user/:id
 * @access  Private
 */
export const getAllocationByUserId = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  if (!isValidId(userId))
    return next(new ErrorResponse(`Invalid user id ${userId}`, 400));

  const allocations = await Allocation.find({
    $or: [{ allocatedTo: userId }, { allocatedBy: userId }],
  }).populate(allocationPopulate);

  res.status(200).json({ success: true, data: allocations });
});

/**
 * @desc    Get Allocations By Asset id
 * @route   GET /api/v1/allocation/asset/:id
 * @access  Private
 */
export const getAllocationByAssetId = asyncHandler(async (req, res, next) => {
  const assetId = req.params.id;
  if (!isValidId(assetId))
    return next(new ErrorResponse(`Invalid asset id ${assetId}`, 400));

  const allocations = await Allocation.find({ asset: assetId }).populate(
    allocationPopulate
  );
  res.status(200).json({ success: true, data: allocations });
});

/**
 * @desc    Generic Update Allocation (does NOT change Asset owner)
 * @route   PUT /api/v1/allocation/:id
 * @access  Private
 */
export const updateAllocation = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id))
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));

  const updated = await Allocation.findByIdAndUpdate(id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!updated)
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));

  const populated = await Allocation.findById(updated._id).populate(
    allocationPopulate
  );

  // Notify optionally about update
  try {
    const userIds = [];
    if (populated.allocatedTo) userIds.push(populated.allocatedTo);
    if (populated.allocatedBy) userIds.push(populated.allocatedBy);
    if (populated.asset) {
      if (populated.asset.owner) userIds.push(populated.asset.owner);
      if (populated.asset.purchaser) userIds.push(populated.asset.purchaser);
    }

    const summary = allocationSummaryForNotify(populated);
    const tokens = await gatherTokensForUserIds(userIds);
    const title = 'Allocation Updated';
    const body = `Allocation for "${summary.assetName}" has been updated.`;
    const data = { type: 'allocation:updated', allocation: summary };
    if (tokens.length) await sendFcmToTokens(tokens, { title, body }, data);

    const recipients = await gatherEmailsForUserIds(userIds);
    if (recipients.length) {
      const subject = 'TAGit — Allocation Updated';
      const emailBody = `
Hello ${summary.requestedTo},

Allocation for "${summary.assetName}" has been updated.

Asset: ${summary.assetName}
Serial No: ${summary.assetSerial}
Requested From: ${summary.requestedFrom} (${summary.requestedFromEmail})
Requested To: ${summary.requestedTo} (${summary.requestedToEmail})
Status: ${summary.status || 'Updated'}
Date: ${summary.date}

Regards,
TAGit
      `;
      await sendEmailsToRecipients(recipients, subject, emailBody);
    }
  } catch (err) {
    console.error('Notify error on updateAllocation:', err);
  }

  res.status(200).json({ success: true, data: populated });
});

/* ======================================================
   @desc     Approve Allocation
   @route    PUT /api/v1/allocation/:id/approve
   @access   Private
====================================================== */
export const approveAllocation = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id))
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));

  const allocation = await Allocation.findById(id);
  if (!allocation)
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));

  allocation.requestStatus = true;
  allocation.status = 'approved';
  allocation.allocationStatusDate = new Date();
  if (req.user && req.user.id) allocation.approvedBy = req.user.id;
  await allocation.save();

  // Update asset availability & owner if needed
  if (allocation.asset) {
    try {
      const updateData = { availablity: false, allocation: allocation._id };
      if (allocation.allocationType === 'Owner' && allocation.allocatedTo) {
        updateData.owner = allocation.allocatedTo;
      }
      await Asset.findByIdAndUpdate(allocation.asset, updateData, {
        new: true,
        runValidators: true,
      });
    } catch (err) {
      console.error('Failed to update asset after approval:', err);
    }
  }

  const populatedAllocation = await Allocation.findById(
    allocation._id
  ).populate(allocationPopulate);

  // Notifications + Emails
  try {
    const toUserIds = [];
    const byUserIds = [];

    if (populatedAllocation.allocatedTo)
      toUserIds.push(populatedAllocation.allocatedTo);
    if (populatedAllocation.allocatedBy)
      byUserIds.push(populatedAllocation.allocatedBy);

    if (populatedAllocation.asset) {
      const asset = populatedAllocation.asset;
      if (asset.owner) byUserIds.push(asset.owner);
      if (asset.purchaser) byUserIds.push(asset.purchaser);
    }

    const summary = allocationSummaryForNotify(populatedAllocation);

    // To (allocatedTo) notifications
    const toTokens = await gatherTokensForUserIds(toUserIds);
    if (toTokens.length) {
      const title =
        populatedAllocation.allocationType === 'Owner'
          ? 'You are now the owner'
          : 'Allocation approved';
      const body =
        populatedAllocation.allocationType === 'Owner'
          ? `${summary.requestedTo}, you have been assigned ownership of ${summary.assetName} (S/N: ${summary.assetSerial}).`
          : `${summary.requestedTo}, your allocation request for ${summary.assetName} (S/N: ${summary.assetSerial}) has been approved.`;
      const data = { type: 'allocation:approved', allocation: summary };
      await sendFcmToTokens(toTokens, { title, body }, data);
    }

    // To (allocatedBy / owners) notifications
    const byTokens = await gatherTokensForUserIds(byUserIds);
    if (byTokens.length) {
      const title =
        populatedAllocation.allocationType === 'Owner'
          ? 'Ownership assigned'
          : 'Allocation approved';
      const body =
        populatedAllocation.allocationType === 'Owner'
          ? `${summary.requestedFrom}, ${summary.requestedTo} has been assigned ownership of ${summary.assetName} (S/N: ${summary.assetSerial}).`
          : `${summary.requestedFrom}, the allocation request for ${summary.assetName} has been approved.`;
      const data = { type: 'allocation:approved', allocation: summary };
      await sendFcmToTokens(byTokens, { title, body }, data);
    }

    // Emails to allocatedTo
    const toRecipients = await gatherEmailsForUserIds(toUserIds);
    if (toRecipients.length) {
      const subject =
        populatedAllocation.allocationType === 'Owner'
          ? 'TAGit — You are now the owner'
          : 'TAGit — Allocation Approved';
      const emailBody = `
Hello ${summary.requestedTo},

Your device allocation request has been approved.

Asset: ${summary.assetName}
Serial No: ${summary.assetSerial}
Requested From: ${summary.requestedFrom} (${summary.requestedFromEmail})
Requested To: ${summary.requestedTo} (${summary.requestedToEmail})
Status: ${summary.status || 'Approved'}
Date: ${summary.date}

Regards,
TAGit
      `;
      const resEmails = await sendEmailsToRecipients(
        toRecipients,
        subject,
        emailBody
      );
      if (resEmails.failed)
        console.warn(
          'approveAllocation email failures (to):',
          resEmails.failures
        );
    }

    // Emails to allocatedBy / owner / purchaser
    const byRecipients = await gatherEmailsForUserIds(byUserIds);
    if (byRecipients.length) {
      const subject =
        populatedAllocation.allocationType === 'Owner'
          ? 'TAGit — Ownership Assigned'
          : 'TAGit — Allocation Approved';
      const emailBody =
        populatedAllocation.allocationType === 'Owner'
          ? `${summary.requestedFrom},\n\n${summary.requestedTo} has been assigned ownership of "${summary.assetName}" (S/N: ${summary.assetSerial}) on ${summary.date}.\n\nRegards,\nTAGit`
          : `${summary.requestedFrom},\n\nThe allocation request for "${summary.assetName}" has been approved on ${summary.date}.\n\nRegards,\nTAGit`;
      const resEmails = await sendEmailsToRecipients(
        byRecipients,
        subject,
        emailBody
      );
      if (resEmails.failed)
        console.warn(
          'approveAllocation email failures (by):',
          resEmails.failures
        );
    }

    console.log('Notifications (FCM + Email) for approveAllocation dispatched');
  } catch (err) {
    console.error('FCM/Email error on approveAllocation:', err);
  }

  const populated = await Allocation.findById(allocation._id).populate(
    allocationPopulate
  );
  res.status(200).json({
    success: true,
    message: 'Allocation approved successfully',
    data: populated,
  });
});

/* ======================================================
   @desc     Reject Allocation
   @route    PUT /api/v1/allocation/:id/reject
   @access   Private
====================================================== */
export const rejectAllocation = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id))
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));

  const allocation = await Allocation.findById(id);
  if (!allocation)
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));

  allocation.requestStatus = false;
  allocation.status = 'rejected';
  allocation.allocationStatusDate = new Date();
  if (req.body.rejectionReason)
    allocation.rejectionReason = req.body.rejectionReason;
  if (req.user && req.user.id) allocation.rejectedBy = req.user.id;
  await allocation.save();

  // Reset asset availability if linked
  if (allocation.asset) {
    try {
      await Asset.findByIdAndUpdate(
        allocation.asset,
        { availablity: true },
        { new: true }
      );
    } catch (err) {
      console.error('Failed to set asset availability on reject:', err);
    }
  }

  const populatedAllocation = await Allocation.findById(
    allocation._id
  ).populate(allocationPopulate);

  // Notifications + Emails
  try {
    const toUserIds = [];
    const byUserIds = [];

    if (populatedAllocation.allocatedTo)
      toUserIds.push(populatedAllocation.allocatedTo);
    if (populatedAllocation.allocatedBy)
      byUserIds.push(populatedAllocation.allocatedBy);

    if (populatedAllocation.asset) {
      const asset = populatedAllocation.asset;
      if (asset.owner) byUserIds.push(asset.owner);
      if (asset.purchaser) byUserIds.push(asset.purchaser);
    }

    const summary = allocationSummaryForNotify(populatedAllocation);

    // FCM to allocatedTo
    const toTokens = await gatherTokensForUserIds(toUserIds);
    if (toTokens.length) {
      const title = 'Allocation Rejected';
      const body = `${summary.requestedTo}, your allocation request for "${summary.assetName}" (S/N: ${summary.assetSerial}) was rejected by ${summary.requestedFrom}.`;
      const data = { type: 'allocation:rejected', allocation: summary };
      await sendFcmToTokens(toTokens, { title, body }, data);
    }

    // FCM to allocatedBy/owner/purchaser
    const byTokens = await gatherTokensForUserIds(byUserIds);
    if (byTokens.length) {
      const title = 'Allocation Rejected';
      const body = `${summary.requestedFrom}, the allocation request for "${summary.assetName}" has been rejected.`;
      const data = { type: 'allocation:rejected', allocation: summary };
      await sendFcmToTokens(byTokens, { title, body }, data);
    }

    // Emails to allocatedTo
    const toRecipients = await gatherEmailsForUserIds(toUserIds);
    if (toRecipients.length) {
      const subject = 'TAGit — Allocation Rejected';
      const emailBody = `
Hello ${summary.requestedTo},

Your device allocation request has been rejected.

Asset: ${summary.assetName}
Serial No: ${summary.assetSerial}
Requested From: ${summary.requestedFrom} (${summary.requestedFromEmail})
Requested To: ${summary.requestedTo} (${summary.requestedToEmail})
Status: ${summary.status || 'Rejected'}
Date: ${summary.date}

Regards,
TAGit
      `;
      const resEmails = await sendEmailsToRecipients(
        toRecipients,
        subject,
        emailBody
      );
      if (resEmails.failed)
        console.warn(
          'rejectAllocation email failures (to):',
          resEmails.failures
        );
    }

    // Emails to allocatedBy / owner / purchaser
    const byRecipients = await gatherEmailsForUserIds(byUserIds);
    if (byRecipients.length) {
      const subject = 'TAGit — Allocation Rejected';
      const emailBody = `
Hello ${summary.requestedFrom},

The allocation request for "${summary.assetName}" has been rejected.

Asset: ${summary.assetName}
Serial No: ${summary.assetSerial}
Requested From: ${summary.requestedFrom} (${summary.requestedFromEmail})
Requested To: ${summary.requestedTo} (${summary.requestedToEmail})
Status: ${summary.status || 'Rejected'}
Date: ${summary.date}

Regards,
TAGit
      `;
      const resEmails = await sendEmailsToRecipients(
        byRecipients,
        subject,
        emailBody
      );
      if (resEmails.failed)
        console.warn(
          'rejectAllocation email failures (by):',
          resEmails.failures
        );
    }

    console.log('Notifications (FCM + Email) for rejectAllocation dispatched');
  } catch (err) {
    console.error('FCM/Email error on rejectAllocation:', err);
  }

  const populated = await Allocation.findById(allocation._id).populate(
    allocationPopulate
  );
  res.status(200).json({
    success: true,
    message: 'Allocation rejected successfully',
    data: populated,
  });
});
