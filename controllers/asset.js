import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Asset from '../models/Asset.js';
import Allocation from '../models/Allocation.js';

//  @desc   Create Asset
//  @route  POST /api/v1/asset
//  @access  Private
export const createAsset = asyncHandler(async (req, res, next) => {
  const create = await Asset.create(req.body);
  await create.populate('purchaser owner allocation', 'name email role');
  res.status(200).json({
    success: true,
    data: create,
  });
});

//  @desc   Update Asset
//  @route  POST /api/v1/asset
//  @access  Private, Authorized
export const updateAsset = asyncHandler(async (req, res, next) => {
  const update = await Asset.findByIdAndUpdate(req.params.id, req.body, {
    new: true,
    runValidators: true,
  })
    .populate('purchaser', 'name email role')
    .populate('owner', 'name email role')
    .populate('allocation', 'name email role');
  res.status(200).json({
    success: true,
    data: update,
  });
});

//  @desc   Delete Asset
//  @route  Delete /api/v1/asset
//  @access  Private, Authorized
export const deleteAsset = asyncHandler(async (req, res, next) => {
  let asset = await Asset.findById(req.params.id);
  let allocation = await Allocation.findById(asset.allocation.id);
  allocation = await Forum.findOneAndUpdate(
    { _id: asset.allocation.id },
    { $pull: { asset: req.params.id } }
  );
  if (!asset) {
    return next(
      new ErrorResponse(`Asset Does not Exist ${req.params.id}`, 404)
    );
  }
  asset = await Asset.findByIdAndDelete(req.params.id);
  res.status(200).json({
    success: true,
    data: {},
  });
});

//  @desc   Get Asset List By id
//  @route  POST /api/v1/asset/:id
//  @access  Private
export const getAssetListById = asyncHandler(async (req, res, next) => {
  let userId = req.params.id;
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

//  @desc   Get All Assets
//  @route  POST /api/v1/asset/
//  @access  Private, Authorized
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
