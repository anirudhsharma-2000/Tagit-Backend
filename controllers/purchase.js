import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Purchase from '../models/Purchase.js';

//  @desc   Create Purchase Request
//  @route  POST /api/v1/purchase
//  @access  Private
export const createRequest = asyncHandler(async (req, res, next) => {
  const create = await Purchase.create(req.body);
  await create.populate('requiredBy requestedBy manager', 'name email role');

  res.status(200).json({
    success: true,
    data: create,
  });
});

// @desc    Update Purchase Request
// @route   PUT /api/v1/purchase/:id
// @access  Private
export const updateManagerRequest = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  let request = await Purchase.findById(userId);
  const managerApproval = req.body;
  if (!request) {
    return next(
      new ErrorResponse(`Request does not Exist with ${userId}`, 404)
    );
  }
  request = await Purchase.findByIdAndUpdate(userId, managerApproval, {
    new: true,
    runValidators: true,
  }).populate('requiredBy requestedBy manager', 'name email role');
  res.status(200).json({
    success: true,
    data: request,
  });
});

// @desc    Update Purchase Request
// @route   PUT /api/v1/purchase/:id
// @access  Private
export const updateRequest = asyncHandler(async (req, res, next) => {
  let request = await Purchase.findById(req.params.id);
  if (!request) {
    return next(
      new ErrorResponse(`Request does not Exist with ${req.params.id}`, 404)
    );
  }
  request = await Purchase.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  }).populate('requiredBy requestedBy manager', 'name email role');
  res.status(200).json({
    success: true,
    data: request,
  });
});

// @desc    Get Request List according to userId
// @route   Get /api/v1/purchase/:id
// @access  Private
export const getRequests = asyncHandler(async (req, res, next) => {
  const userId = req.params.id;
  let request = await Purchase.find({
    $or: [{ requiredBy: userId }, { requestedBy: userId }, { manager: userId }],
  }).populate('requiredBy requestedBy manager', 'name email role');
  res.status(200).json({
    success: true,
    data: request,
  });
});

// @desc    Get Request List
// @route   Get /api/v1/purchase/:id
// @access  Private
export const getAllRequests = asyncHandler(async (req, res, next) => {
  let request = await Purchase.find().populate(
    'requiredBy requestedBy manager',
    'name email role'
  );
  res.status(200).json({
    success: true,
    data: request,
  });
});
