import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Asset from '../models/Asset.js';
import { sendFcmToTokens } from '../utils/fcm.js';
import User from '../models/User.js'; // to get FCM tokens

// Utility to gather tokens for users
async function gatherTokensForUserIds(userIds = []) {
  if (!userIds.length) return [];
  const users = await User.find({ _id: { $in: userIds } }).select('fcmTokens');
  return users.flatMap((u) => u.fcmTokens || []);
}

// -------------------- Create Asset --------------------
export const createAsset = asyncHandler(async (req, res, next) => {
  const create = await Asset.create(req.body);
  await create.populate('purchaser owner allocation', 'name email role');

  // --- Send FCM ---
  try {
    const userIds = [];
    if (create.purchaser) userIds.push(create.purchaser);
    if (create.owner) userIds.push(create.owner);

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      await sendFcmToTokens(
        tokens,
        { title: 'New Asset Created', body: `${create.name} created.` },
        { type: 'asset:create', assetId: String(create._id) }
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

  // --- Send FCM ---
  try {
    const userIds = [];
    if (update.purchaser) userIds.push(update.purchaser);
    if (update.owner) userIds.push(update.owner);
    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      await sendFcmToTokens(
        tokens,
        { title: 'Asset Updated', body: `${update.name} updated.` },
        { type: 'asset:update', assetId: String(update._id) }
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

  // Optional: notify purchaser and owner
  try {
    const userIds = [];
    if (asset.purchaser) userIds.push(asset.purchaser);
    if (asset.owner) userIds.push(asset.owner);
    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      await sendFcmToTokens(
        tokens,
        { title: 'Asset Deleted', body: `${asset.name} has been deleted.` },
        { type: 'asset:delete', assetId: String(asset._id) }
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
