import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Allocation from '../models/Allocation.js';
import Asset from '../models/Asset.js';
import mongoose from 'mongoose';

const allocationPopulate = [
  { path: 'allocatedBy', select: 'name email role' },
  { path: 'allocatedTo', select: 'name email role' },
  {
    path: 'asset',
    select: 'name serialNumber owner purchaser assetImageUrl invoiceUrl',
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

// ======================================================
// @desc     Approve Allocation
// @route    PUT /api/v1/allocation/:id/approve
// @access   Private
// ======================================================
export const approveAllocation = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id)) {
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));
  }

  // Find allocation
  const allocation = await Allocation.findById(id);
  if (!allocation) {
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));
  }

  // Update allocation fields
  allocation.requestStatus = true;
  allocation.status = 'approved';
  allocation.allocationStatusDate = new Date();

  if (req.user && req.user.id) {
    allocation.approvedBy = req.user.id;
  }

  await allocation.save();

  // Update the asset: mark unavailable and link allocation
  if (allocation.asset) {
    try {
      await Asset.findByIdAndUpdate(
        allocation.asset,
        {
          availablity: false,
          allocation: allocation._id,
        },
        { new: true }
      );
    } catch (err) {
      console.error('Failed to update asset availability on approve:', err);
    }
  }

  // Return populated allocation
  const populated = await Allocation.findById(allocation._id).populate(
    allocationPopulate
  );

  res.status(200).json({
    success: true,
    message: 'Allocation approved successfully',
    data: populated,
  });
});

// ======================================================
// @desc     Reject Allocation
// @route    PUT /api/v1/allocation/:id/reject
// @access   Private
// ======================================================
export const rejectAllocation = asyncHandler(async (req, res, next) => {
  const id = req.params.id;
  if (!isValidId(id)) {
    return next(new ErrorResponse(`Invalid allocation id ${id}`, 400));
  }

  const allocation = await Allocation.findById(id);
  if (!allocation) {
    return next(new ErrorResponse(`Allocation not found with id ${id}`, 404));
  }

  allocation.requestStatus = false;
  allocation.status = 'rejected';
  allocation.allocationStatusDate = new Date();
  await allocation.save();

  const populated = await Allocation.findById(allocation._id).populate(
    allocationPopulate
  );

  res.status(200).json({
    success: true,
    message: 'Allocation rejected successfully',
    data: populated,
  });
});
