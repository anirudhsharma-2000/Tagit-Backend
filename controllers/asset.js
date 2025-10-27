// controllers/asset.js
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Asset from '../models/Asset.js';
import { sendFcmToTokens } from '../utils/fcm.js';
import User from '../models/User.js';
import mongoose from 'mongoose';

/**
 * Normalize a list of user identifiers (ids, ObjectId, or populated objects with _id)
 * -> returns array of valid string ObjectId values.
 */
function normalizeUserIds(input = []) {
  if (!Array.isArray(input)) input = [input];
  const ids = input
    .map((v) => {
      if (!v) return null;
      if (typeof v === 'object') {
        if (v._id) return String(v._id);
        // sometimes Mongoose ObjectId instance
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
 * Gather tokens for all admins.
 */
async function gatherAdminTokens() {
  const admins = await User.find({ role: 'admin' }).select('fcmTokens').lean();
  const tokens = admins.flatMap((a) =>
    Array.isArray(a.fcmTokens) ? a.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
}

// -------------------- Create Asset --------------------
export const createAsset = asyncHandler(async (req, res, next) => {
  const create = await Asset.create(req.body);
  await create.populate('purchaser owner allocation', 'name email role');

  // --- Send FCM to purchaser/owner + admins ---
  try {
    const targetUserIds = [];
    if (create.purchaser) targetUserIds.push(create.purchaser);
    if (create.owner) targetUserIds.push(create.owner);

    // get tokens for purchaser/owner
    const tokens = await gatherTokensForUserIds(targetUserIds);

    // get admin tokens separately and merge
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    if (allTokens.length) {
      await sendFcmToTokens(
        allTokens,
        { title: 'New Asset Created', body: `${create.name} created.` },
        { type: 'asset:create', assetId: String(create._id) }
      );
    } else {
      console.log(
        'createAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('FCM error on createAsset:', err);
  }

  res.status(200).json({
    success: true,
    data: create,
  });
});

// -------------------- Update Asset --------------------
export const updateAsset = asyncHandler(async (req, res, next) => {
  const update = await Asset.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate('purchaser', 'name email role')
    .populate('owner', 'name email role')
    .populate('allocation', 'name email role');

  // --- Send FCM to purchaser/owner + admins ---
  try {
    const targetUserIds = [];
    if (update.purchaser) targetUserIds.push(update.purchaser);
    if (update.owner) targetUserIds.push(update.owner);

    const tokens = await gatherTokensForUserIds(targetUserIds);
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    if (allTokens.length) {
      await sendFcmToTokens(
        allTokens,
        { title: 'Asset Updated', body: `${update.name} updated.` },
        { type: 'asset:update', assetId: String(update._id) }
      );
    } else {
      console.log(
        'updateAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('FCM error on updateAsset:', err);
  }

  res.status(200).json({
    success: true,
    data: update,
  });
});

// -------------------- Delete Asset --------------------
export const deleteAsset = asyncHandler(async (req, res, next) => {
  let asset = await Asset.findById(req.params.id);
  if (!asset) {
    return next(
      new ErrorResponse(`Asset Does not Exist ${req.params.id}`, 404)
    );
  }

  // Optional: notify purchaser and owner + admins
  try {
    const targetUserIds = [];
    if (asset.purchaser) targetUserIds.push(asset.purchaser);
    if (asset.owner) targetUserIds.push(asset.owner);

    const tokens = await gatherTokensForUserIds(targetUserIds);
    const adminTokens = await gatherAdminTokens();
    const allTokens = Array.from(
      new Set([...(tokens || []), ...(adminTokens || [])])
    );

    if (allTokens.length) {
      await sendFcmToTokens(
        allTokens,
        { title: 'Asset Deleted', body: `${asset.name} has been deleted.` },
        { type: 'asset:delete', assetId: String(asset._id) }
      );
    } else {
      console.log(
        'deleteAsset: no FCM tokens found for purchaser/owner/admins'
      );
    }
  } catch (err) {
    console.error('FCM error on deleteAsset:', err);
  }

  asset = await Asset.findByIdAndDelete(req.params.id);
  res.status(200).json({
    success: true,
    data: {},
  });
});

// -------------------- Get Asset List By ID --------------------
export const getAssetListById = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  const assets = await Asset.find({
    $or: [
      { purchaser: userId },
      { owner: userId },
      { 'allocation.allocatedBy': userId },
      { 'allocation.allocatedTo': userId },
    ],
  })
    .populate('purchaser', 'name email role')
    .populate('owner', 'name email role')
    .populate('allocation', 'name email role');

  res.status(200).json({
    success: true,
    data: assets,
  });
});

// -------------------- Get All Assets --------------------
export const getAssets = asyncHandler(async (req, res, next) => {
  const assets = await Asset.find()
    .populate('purchaser', 'name email role')
    .populate('owner', 'name email role')
    .populate('allocation', 'name email role');

  res.status(200).json({
    success: true,
    data: assets,
  });
});
