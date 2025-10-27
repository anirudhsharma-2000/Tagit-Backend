// controllers/purchase.js
import mongoose from 'mongoose';
import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import { sendFcmToTokens } from '../utils/fcm.js';

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
 * notify all admins helper
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

  // populate only for response convenience (doesn't affect token logic)
  await create.populate('requiredBy requestedBy', 'name email role');

  // Send notifications to requiredBy, requestedBy and admins
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
    } else {
      console.log(
        'createRequest: no tokens found for involved users',
        normalizeUserIds(userIds)
      );
    }

    // notify admins
    await notifyAdmins(
      'New Purchase Request',
      `${create.assetName || 'Purchase request'} created`,
      { type: 'purchase:create', purchaseId: String(create._1d) }
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
    } else {
      console.log(
        'updateRequest: no tokens found for involved users',
        normalizeUserIds(userIds)
      );
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
