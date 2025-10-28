// controllers/asset.js
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Asset from '../models/Asset.js';
import User from '../models/User.js';
import Allocation from '../models/Allocation.js';
import mongoose from 'mongoose';
import { sendFcmToTokens } from '../utils/fcm.js';
import sendEmail from '../utils/sendMail.js';

const ASSET_POPULATE_FIELDS = [
  { path: 'purchaser', select: 'name email role profilePhotoUrl' },
  { path: 'owner', select: 'name email role profilePhotoUrl' },
  {
    path: 'allocation',
    populate: [
      { path: 'allocatedBy', select: 'name email role profilePhotoUrl' },
      { path: 'allocatedTo', select: 'name email role profilePhotoUrl' },
      { path: 'asset', select: 'name model serialNo' },
    ],
  },
];

// helper to apply consistent populate fields
function applyAssetPopulate(query) {
  return query.populate(ASSET_POPULATE_FIELDS);
}

/* ---------------------- Helpers ---------------------- */

/**
 * Normalize a list of user identifiers (ids, ObjectId, or populated objects with _id)
 * -> returns array of valid string ObjectId values.
 */
function normalizeUserIds(input = []) {
  if (!Array.isArray(input)) input = [input];
  const ids = input
    .map((v) => {
      if (!v) return null;
      // If already populated object with _id
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
      return String(v);
    })
    .filter(Boolean);
  return ids.filter((id) => mongoose.Types.ObjectId.isValid(id));
}

/**
 * Gather FCM tokens for given user ids (accepts ids or populated objects).
 * Returns deduped array of token strings.
 */
async function gatherTokensForUserIds(userIds = []) {
  const ids = normalizeUserIds(userIds);
  if (!ids.length) return [];
  const uniqueIds = Array.from(new Set(ids));
  const users = await User.find({ _id: { $in: uniqueIds } })
    .select('fcmTokens')
    .lean();
  const tokens = users.flatMap((u) =>
    Array.isArray(u.fcmTokens) ? u.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
}

/**
 * Gather emails (and names) for given user ids (accepts ids or populated objects).
 * Returns array of { email, name } deduped.
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
 * Gather tokens for all admins.
 */
async function gatherAdminTokens() {
  const admins = await User.find({ role: 'admin' }).select('fcmTokens').lean();
  const tokens = admins.flatMap((a) =>
    Array.isArray(a.fcmTokens) ? a.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
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
 * Small helper to build an asset summary used in notifications/emails.
 * Sanitizes fields (prevents functions showing up) and avoids leaking internal DB ids.
 * NOTE: warranty expiry removed as requested.
 */
function assetSummaryForNotify(assetDoc = {}) {
  // model sanitization
  let modelText = '';
  try {
    if (typeof assetDoc.model === 'string') {
      modelText = assetDoc.model;
    } else if (
      assetDoc.model &&
      typeof assetDoc.model === 'object' &&
      assetDoc.model.name
    ) {
      modelText = String(assetDoc.model.name);
    } else if (assetDoc.model && typeof assetDoc.model !== 'function') {
      modelText = String(assetDoc.model);
    } else {
      modelText = '';
    }
  } catch (e) {
    modelText = '';
  }

  const serial = assetDoc.serialNo || assetDoc.serial || '';

  // Prefer purchasedOn, fallback to purchaseDate
  const purchasedOnRaw =
    assetDoc.purchasedOn ||
    assetDoc.purchaseDate ||
    assetDoc.purchasedAt ||
    null;
  const purchasedOn = purchasedOnRaw ? new Date(purchasedOnRaw) : null;
  const purchaseDateText = purchasedOn
    ? purchasedOn.toLocaleDateString('en-IN')
    : '—';

  return {
    name: assetDoc.name || 'Unknown asset',
    model: modelText || '—',
    serialNo: serial || '—',
    purchaseDate: purchaseDateText,
    purchaserName: assetDoc.purchaser?.name || '—',
    purchaserEmail: assetDoc.purchaser?.email || '—',
    ownerName: assetDoc.owner?.name || '—',
    ownerEmail: assetDoc.owner?.email || '—',
  };
}

/* ---------------------- Controllers ---------------------- */

// Create Asset
export const createAsset = asyncHandler(async (req, res, next) => {
  // Create asset
  const created = await Asset.create(req.body);

  // Re-query populated document to ensure purchaser/owner/allocation (and nested allocatedBy/allocatedTo) are populated
  const populatedAsset = await applyAssetPopulate(Asset.findById(created._id));

  try {
    const targetUserIds = [];
    if (populatedAsset.purchaser) targetUserIds.push(populatedAsset.purchaser);
    if (populatedAsset.owner) targetUserIds.push(populatedAsset.owner);

    const tokens = await gatherTokensForUserIds(targetUserIds);
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    const summary = assetSummaryForNotify(populatedAsset);

    if (allTokens.length) {
      try {
        await sendFcmToTokens(
          allTokens,
          { title: 'New Asset Created', body: `${summary.name} created.` },
          { type: 'asset:create', asset: summary }
        );
      } catch (err) {
        console.error('FCM error on createAsset:', err);
      }
    } else {
      console.log(
        'createAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }

    // Emails to purchaser/owner + admins
    const recipients = [];
    if (populatedAsset.purchaser) recipients.push(populatedAsset.purchaser);
    if (populatedAsset.owner) recipients.push(populatedAsset.owner);
    const recipientEmails = await gatherEmailsForUserIds(recipients);
    const adminEmails = await gatherAdminEmails();
    // merge unique by email
    const allRecipientEmails = Array.from(
      new Map(
        [...recipientEmails, ...adminEmails].map((r) => [r.email, r])
      ).values()
    );

    if (allRecipientEmails.length) {
      const subject = 'TAGit — New Asset Created';
      const emailBody = `
Hello,

A new asset has been registered in TAGit.

Asset: ${summary.name}
Model: ${summary.model}
Serial No: ${summary.serialNo}
Purchase Date: ${summary.purchaseDate}

Purchaser: ${summary.purchaserName} (${summary.purchaserEmail})
Owner: ${summary.ownerName} (${summary.ownerEmail})

Regards,
TAGit
      `;
      const emailRes = await sendEmailsToRecipients(
        allRecipientEmails,
        subject,
        emailBody
      );
      if (emailRes.failed)
        console.warn('createAsset email failures', emailRes.failures);
      else console.log(`createAsset Emails sent: ${emailRes.sent}`);
    } else {
      console.log(
        'createAsset: no email recipients found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('Notification error on createAsset:', err);
  }

  res.status(201).json({ success: true, data: populatedAsset });
});

// Update Asset
export const updateAsset = asyncHandler(async (req, res, next) => {
  const updated = await Asset.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  });

  if (!updated)
    return next(new ErrorResponse(`Asset not found ${req.params.id}`, 404));

  const populatedUpdate = await applyAssetPopulate(Asset.findById(updated._id));

  try {
    const targetUserIds = [];
    if (populatedUpdate.purchaser)
      targetUserIds.push(populatedUpdate.purchaser);
    if (populatedUpdate.owner) targetUserIds.push(populatedUpdate.owner);

    const tokens = await gatherTokensForUserIds(targetUserIds);
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    const summary = assetSummaryForNotify(populatedUpdate);

    if (allTokens.length) {
      try {
        await sendFcmToTokens(
          allTokens,
          { title: 'Asset Updated', body: `${summary.name} updated.` },
          { type: 'asset:update', asset: summary }
        );
      } catch (err) {
        console.error('FCM error on updateAsset:', err);
      }
    } else {
      console.log(
        'updateAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }

    // Emails
    const recipientEmails = [];
    if (populatedUpdate.purchaser)
      recipientEmails.push(populatedUpdate.purchaser);
    if (populatedUpdate.owner) recipientEmails.push(populatedUpdate.owner);
    const recipientList = await gatherEmailsForUserIds(recipientEmails);
    const adminList = await gatherAdminEmails();
    const allRecipientEmails = Array.from(
      new Map(
        [...recipientList, ...adminList].map((r) => [r.email, r])
      ).values()
    );

    if (allRecipientEmails.length) {
      const subject = 'TAGit — Asset Updated';
      const emailBody = `
Hello,

An asset has been updated in TAGit.

Asset: ${summary.name}
Model: ${summary.model}
Serial No: ${summary.serialNo}
Purchase Date: ${summary.purchaseDate}

Purchaser: ${summary.purchaserName} (${summary.purchaserEmail})
Owner: ${summary.ownerName} (${summary.ownerEmail})

Regards,
TAGit
      `;
      const emailRes = await sendEmailsToRecipients(
        allRecipientEmails,
        subject,
        emailBody
      );
      if (emailRes.failed)
        console.warn('updateAsset email failures', emailRes.failures);
      else console.log(`updateAsset Emails sent: ${emailRes.sent}`);
    } else {
      console.log(
        'updateAsset: no email recipients found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('Notification error on updateAsset:', err);
  }

  res.status(200).json({ success: true, data: populatedUpdate });
});

// Delete Asset
export const deleteAsset = asyncHandler(async (req, res, next) => {
  let asset = await applyAssetPopulate(Asset.findById(req.params.id)).lean();
  if (!asset)
    return next(
      new ErrorResponse(`Asset Does not Exist ${req.params.id}`, 404)
    );

  try {
    const targetUserIds = [];
    if (asset.purchaser) targetUserIds.push(asset.purchaser);
    if (asset.owner) targetUserIds.push(asset.owner);

    const tokens = await gatherTokensForUserIds(targetUserIds);
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    const summary = assetSummaryForNotify(asset);

    if (allTokens.length) {
      try {
        await sendFcmToTokens(
          allTokens,
          { title: 'Asset Deleted', body: `${summary.name} has been deleted.` },
          { type: 'asset:delete', asset: summary }
        );
      } catch (err) {
        console.error('FCM error on deleteAsset:', err);
      }
    } else {
      console.log(
        'deleteAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }

    // Emails
    const recipientEmails = [];
    if (asset.purchaser) recipientEmails.push(asset.purchaser);
    if (asset.owner) recipientEmails.push(asset.owner);
    const recipientList = await gatherEmailsForUserIds(recipientEmails);
    const adminList = await gatherAdminEmails();
    const allRecipientEmails = Array.from(
      new Map(
        [...recipientList, ...adminList].map((r) => [r.email, r])
      ).values()
    );

    if (allRecipientEmails.length) {
      const subject = 'TAGit — Asset Deleted';
      const emailBody = `
Hello,

An asset has been deleted from TAGit.

Asset: ${summary.name}
Model: ${summary.model}
Serial No: ${summary.serialNo}
Purchase Date: ${summary.purchaseDate}

Purchaser: ${summary.purchaserName} (${summary.purchaserEmail})
Owner: ${summary.ownerName} (${summary.ownerEmail})

Regards,
TAGit
      `;
      const emailRes = await sendEmailsToRecipients(
        allRecipientEmails,
        subject,
        emailBody
      );
      if (emailRes.failed)
        console.warn('deleteAsset email failures', emailRes.failures);
      else console.log(`deleteAsset Emails sent: ${emailRes.sent}`);
    } else {
      console.log(
        'deleteAsset: no email recipients found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('Notification error on deleteAsset:', err);
  }

  await Asset.findByIdAndDelete(req.params.id);
  res.status(200).json({ success: true, data: {} });
});

// Get Asset List By User ID
export const getAssetListById = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  const assets = await applyAssetPopulate(
    Asset.find({
      $or: [
        { purchaser: userId },
        { owner: userId },
        { 'allocation.allocatedBy': userId },
        { 'allocation.allocatedTo': userId },
      ],
    })
  ).exec();

  res.status(200).json({ success: true, data: assets });
});

// Get All Assets
export const getAssets = asyncHandler(async (req, res, next) => {
  const assets = await applyAssetPopulate(Asset.find()).exec();
  res.status(200).json({ success: true, data: assets });
});

/**
 * @desc    Get full details of a single asset by ID
 * @route   GET /api/assets/:id
 * @access  Private (adjust as per your middleware)
 */
export const getAssetDetailsById = asyncHandler(async (req, res, next) => {
  const { id } = req.params;

  // Fetch asset by ID and deeply populate all related fields
  const asset = await Asset.findById(id).populate(ASSET_POPULATE_FIELDS);

  if (!asset) {
    res.status(404);
    throw new Error('Asset not found');
  }

  res.status(200).json({
    success: true,
    data: asset,
  });
});
