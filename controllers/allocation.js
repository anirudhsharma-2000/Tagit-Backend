import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Allocation from '../models/Allocation.js';
import Asset from '../models/Asset.js';
import User from '../models/User.js';
import mongoose from 'mongoose';
import { sendFcmToTokens } from '../utils/fcm.js';

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
 * Helper: gather tokens for a list of user ids (deduped)
 */
async function gatherTokensForUserIds(userIds = []) {
  const ids = Array.from(new Set(userIds.filter(Boolean).map(String)));
  if (!ids.length) return [];
  const users = await User.find({ _id: { $in: ids } }).select('fcmTokens');
  const tokens = users.flatMap((u) => u.fcmTokens || []);
  return Array.from(new Set(tokens)); // dedupe tokens
}

/**
 * @desc    Create Allocation
 * @route   POST /api/v1/allocation
 * @access  Private
 */
export const createAllocation = asyncHandler(async (req, res, next) => {
  // req.body should contain allocatedBy, allocatedTo, asset, allocationType, etc.
  // create allocation
  const create = await Allocation.create(req.body);

  // If the allocation references an asset, set that asset's `allocation` field
  if (create.asset) {
    try {
      // update asset to reference this allocation id
      await Asset.findByIdAndUpdate(
        create.asset,
        { allocation: create._id },
        { new: true }
      );
    } catch (err) {
      // log but don't fail the whole request; approval flow still in charge of owner change
      console.error(
        'Failed to set asset.allocation after allocation create:',
        err
      );
    }
  }

  try {
    const userIds = [];
    if (create.allocatedTo) userIds.push(create.allocatedTo);
    if (create.allocatedBy) userIds.push(create.allocatedBy);
    // also notify asset owner and purchaser optionally
    if (create.asset) {
      const asset = await Asset.findById(create.asset).select(
        'owner purchaser'
      );
      if (asset?.owner) userIds.push(asset.owner);
      if (asset?.purchaser) userIds.push(asset.purchaser);
    }

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'New Allocation Created';
      const body = `Allocation (${
        create.allocationType || 'Allocation'
      }) created for asset`;
      const data = {
        type: 'allocation:create',
        allocationId: String(create._id),
      };
      const fcmRes = await sendFcmToTokens(tokens, { title, body }, data);
      console.log('FCM createAllocation result', fcmRes);
    }
  } catch (err) {
    console.error('FCM error on createAllocation:', err);
  }

  // Populate the allocation (including asset -> owner/purchaser if allocationPopulate defined)
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

  res.status(200).json({
    success: true,
    data: allocation,
  });
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

  res.status(200).json({
    success: true,
    data: allocations,
  });
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
  res.status(200).json({
    success: true,
    data: allocations,
  });
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

  // Return populated allocation (no owner mutation here)
  const populated = await Allocation.findById(updated._id).populate(
    allocationPopulate
  );

  res.status(200).json({
    success: true,
    data: populated,
  });
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

  console.log('✅ Approving Allocation:', id);
  console.log('🔹 Allocation Type:', allocation.allocationType);
  console.log('🔹 Asset ID:', allocation.asset);
  console.log('🔹 Allocated To:', allocation.allocatedTo);

  allocation.requestStatus = true;
  allocation.status = 'approved';
  allocation.allocationStatusDate = new Date();
  if (req.user && req.user.id) allocation.approvedBy = req.user.id;

  await allocation.save();

  // --- Update the related asset ---
  if (allocation.asset) {
    const updateData = {
      availablity: false, // Mark as unavailable once allocated
      allocation: allocation._id,
    };

    // If this allocation transfers ownership
    if (allocation.allocationType === 'Owner' && allocation.allocatedTo) {
      updateData.owner = allocation.allocatedTo;
      console.log('👑 Changing asset owner to allocatedTo user');
    }

    const updatedAsset = await Asset.findByIdAndUpdate(
      allocation.asset,
      updateData,
      { new: true }
    );

    if (!updatedAsset) {
      console.error('❌ Failed to update Asset: asset not found');
    } else {
      console.log(
        '✅ Asset updated:',
        updatedAsset._id,
        'availability:',
        updatedAsset.availablity
      );
    }
  } else {
    console.warn(
      '⚠️ Allocation has no asset reference, skipping asset update.'
    );
  }

  // Send FCM notification about approval
  try {
    const userIds = [];
    if (allocation.allocatedTo) userIds.push(allocation.allocatedTo);
    if (allocation.allocatedBy) userIds.push(allocation.allocatedBy);

    // also notify asset purchaser/owner if needed
    if (allocation.asset) {
      const asset = await Asset.findById(allocation.asset).select(
        'owner purchaser'
      );
      if (asset?.owner) userIds.push(asset.owner);
      if (asset?.purchaser) userIds.push(asset.purchaser);
    }

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'Allocation Approved';
      const body =
        allocation.allocationType === 'Owner'
          ? `You have been assigned ownership of the asset.`
          : `Your allocation request has been approved.`;
      const data = {
        type: 'allocation:approved',
        allocationId: String(allocation._id),
      };
      const fcmRes = await sendFcmToTokens(tokens, { title, body }, data);
      console.log('FCM approveAllocation result', fcmRes);
    }
  } catch (err) {
    console.error('FCM error on approveAllocation:', err);
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

  console.log('❌ Rejecting Allocation:', id);

  allocation.requestStatus = false;
  allocation.status = 'rejected';
  allocation.allocationStatusDate = new Date();
  await allocation.save();

  // If an asset was linked, make sure it remains available
  if (allocation.asset) {
    try {
      await Asset.findByIdAndUpdate(
        allocation.asset,
        { availablity: true },
        { new: true }
      );
      console.log('✅ Asset set back to available:', allocation.asset);
    } catch (err) {
      console.error('❌ Failed to set asset availability on reject:', err);
    }
  }

  // Send FCM notification about rejection
  try {
    const userIds = [];
    if (allocation.allocatedTo) userIds.push(allocation.allocatedTo);
    if (allocation.allocatedBy) userIds.push(allocation.allocatedBy);

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'Allocation Rejected';
      const body = `Your allocation request was rejected.`;
      const data = {
        type: 'allocation:rejected',
        allocationId: String(allocation._id),
      };
      const fcmRes = await sendFcmToTokens(tokens, { title, body }, data);
      console.log('FCM rejectAllocation result', fcmRes);
    }
  } catch (err) {
    console.error('FCM error on rejectAllocation:', err);
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
