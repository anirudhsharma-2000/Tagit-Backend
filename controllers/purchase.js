// controllers/purchase.js
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import { sendFcmToTokens } from '../utils/fcm.js';

/**
 * Helper: gather FCM tokens for an array of userIds (deduped)
 */
async function gatherTokensForUserIds(userIds = []) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const ids = Array.from(new Set(userIds.filter(Boolean).map(String)));
  const users = await User.find({ _id: { $in: ids } })
    .select('fcmTokens name')
    .lean();
  const tokens = users.flatMap((u) =>
    Array.isArray(u.fcmTokens) ? u.fcmTokens : []
  );
  return Array.from(new Set(tokens.filter(Boolean)));
}

/**
 * Helper: notify all admins
 */
async function notifyAdmins(title, body, data = {}) {
  try {
    const admins = await User.find({ role: 'admin' }).select('_id').lean();
    const adminIds = admins.map((a) => a._id).filter(Boolean);
    if (!adminIds.length) return;
    const tokens = await gatherTokensForUserIds(adminIds);
    if (!tokens.length) return;
    await sendFcmToTokens(tokens, { title, body }, data);
  } catch (err) {
    console.error('notifyAdmins error:', err);
  }
}

/**
 * @desc   Create Purchase Request
 * @route  POST /api/v1/purchase
 * @access Private
 */
export const createRequest = asyncHandler(async (req, res, next) => {
  const create = await Purchase.create(req.body);
  await create.populate('requiredBy requestedBy', 'name email role');

  // Notify involved users and admins
  try {
    const userIds = [];
    if (create.requiredBy) userIds.push(create.requiredBy);
    if (create.requestedBy) userIds.push(create.requestedBy);

    const tokens = await gatherTokensForUserIds(userIds);
    if (tokens.length) {
      const title = 'New Purchase Request';
      const body = `${create.assetName || 'Purchase request'} created by ${
        create.requestedBy?.name || 'user'
      }`;
      const data = { type: 'purchase:create', purchaseId: String(create._id) };
      await sendFcmToTokens(tokens, { title, body }, data);
    }

    await notifyAdmins(
      'New Purchase Request',
      `${create.assetName || 'Purchase request'} created`,
      { type: 'purchase:create', purchaseId: String(create._id) }
    );
  } catch (err) {
    console.error('FCM error on createRequest:', err);
  }

  res.status(200).json({
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
      const data = { type: 'purchase:update', purchaseId: String(request._id) };
      await sendFcmToTokens(tokens, { title, body }, data);
    }

    await notifyAdmins(
      'Purchase Request Updated',
      `${request.assetName || 'Purchase request'} was updated`,
      { type: 'purchase:update', purchaseId: String(request._id) }
    );
  } catch (err) {
    console.error('FCM error on updateRequest:', err);
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
