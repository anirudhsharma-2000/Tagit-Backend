import ErrorResponse from '../utils/ErrorResponse.js';
import asyncHandler from '../middleware/async.js';
import User from '../models/User.js';
import { OAuth2Client } from 'google-auth-library';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';

const client = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const allowedDomains = ['circuithouse.tech', 'lumio.co.in'];
const ALLOWED_ROLES = ['member', 'purchaser', 'admin'];

//  @desc   Login User
//  @route  POST /api/v1/auth/login
//  @access  Public
export const login = asyncHandler(async (req, res, next) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return next(new ErrorResponse('idToken is required', 400));
    const ticket = await client.verifyIdToken({
      idToken,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const {
      sub: providerId,
      email,
      email_verified,
      name,
      picture,
      phoneNumber,
    } = payload;

    if (!email || !email_verified)
      return next(new ErrorResponse('Email not verified by Google', 403));

    // Commented for temporary purpose

    // Validate domain
    // const domain = email.split('@')[1].toLowerCase();
    // if (
    //   !allowedDomains.includes(domain) &&
    //   !allowedDomains.some((d) => domain.endsWith('.' + d))
    // ) {
    //   return next(new ErrorResponse('Email domain not allowed', 403));
    // }
    const user = await User.findOneAndUpdate(
      { email },
      {
        $set: {
          provider: 'google',
          providerId,
          name,
          profilePhotoUrl: picture,
          lastLogin: new Date(),
          phoneNumber: phoneNumber,
        },
        $setOnInsert: { createdAt: new Date() },
      },
      { upsert: true, new: true, runValidators: true }
    );
    const accessToken = user.getSignedAccessToken();
    const refreshToken = user.getSignedRefreshToken();

    res.status(200).json({
      success: true,
      accessToken: accessToken,
      refreshToken: refreshToken,
    });
  } catch (err) {
    console.log(`Login error: ${err}`.red.bold);
    return next(new ErrorResponse('Invalid Token', 401));
  }
});

export const justCreate = asyncHandler(async (req, res, next) => {
  const user = await User.create(req.body);
  const accessToken = user.getSignedAccessToken();
  const refreshToken = user.getSignedRefreshToken();

  res.status(200).json({
    success: true,
    accessToken: accessToken,
    refreshToken: refreshToken,
    data: user,
  });
});

/**
 * @desc    Update a user's role
 * @route   PUT /api/v1/auth/:id/role
 * @access  Private (admin only)
 */
export const updateUserRole = asyncHandler(async (req, res, next) => {
  const targetUserId = req.params.id;
  const { role } = req.body;

  // auth guard: ensure requester is authenticated
  if (!req.user || !req.user.id) {
    return next(new ErrorResponse('Not authenticated', 401));
  }

  // only admins can change roles
  if (req.user.role !== 'admin') {
    return next(
      new ErrorResponse('Not authorized to change roles. Admins only.', 403)
    );
  }

  // validate target id
  if (!mongoose.Types.ObjectId.isValid(targetUserId)) {
    return next(new ErrorResponse(`Invalid user id ${targetUserId}`, 400));
  }

  // validate requested role
  if (!role || typeof role !== 'string') {
    return next(new ErrorResponse('Role is required in request body', 400));
  }

  const newRole = role.trim();
  if (!ALLOWED_ROLES.includes(newRole)) {
    return next(
      new ErrorResponse(
        `Invalid role. Allowed roles: ${ALLOWED_ROLES.join(', ')}`,
        400
      )
    );
  }

  // perform update
  const updated = await User.findByIdAndUpdate(
    targetUserId,
    { role: newRole },
    { new: true, runValidators: true }
  ).select('-password -refreshToken'); // remove sensitive fields

  if (!updated) {
    return next(
      new ErrorResponse(`User not found with id ${targetUserId}`, 404)
    );
  }

  res.status(200).json({
    success: true,
    message: `User role updated to '${newRole}'`,
    data: updated,
  });
});

//  @desc   Get Current User
//  @route  GET /api/v1/auth/me
//  @access  Private
export const getMe = asyncHandler(async (req, res, next) => {
  const user = await User.findById(req.user.id);
  res.status(200).json({
    success: true,
    data: user,
  });
});

//  @desc   Refresh Access Token
//  @route  POST /api/v1/auth/refresh
//  @access  Public
export const refreshToken = asyncHandler(async (req, res, next) => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    console.log(`Error Before: ${err}`.red.bold);
    return next(new ErrorResponse('Invalid Token', 403));
  }
  try {
    const verifyToken = jwt.verify(
      refreshToken,
      process.env.REFRESH_JWT_SECRET
    );
    const id = verifyToken.id;
    const user = await User.findById(id);
    const accessToken = user.getSignedAccessToken();
    res.status(200).json({
      success: true,
      accessToken: accessToken,
    });
  } catch (err) {
    console.log(`Error: ${err}`.red.bold);
    return next(new ErrorResponse('Invalid Token', 403));
  }
});

//  @desc   Admin and Purchase List
//  @route  POST /api/v1/auth/modlist
//  @access  Public
export const modList = asyncHandler(async (req, res, next) => {
  const users = await User.find({ role: { $in: ['admin', 'purchaser'] } });
  res.status(200).json({
    success: true,
    data: users,
  });
});

//  @desc   All List
//  @route  POST /api/v1/auth/modlist
//  @access  Public
export const userList = asyncHandler(async (req, res, next) => {
  const users = await User.find();
  res.status(200).json({
    success: true,
    data: users,
  });
});

// routes/auth.js (example)
export const registerFcm = asyncHandler(async (req, res) => {
  const { token } = req.body;
  if (!token)
    return res.status(400).json({ success: false, message: 'Token required' });

  const user = await User.findById(req.user.id);
  if (!user)
    return res.status(404).json({ success: false, message: 'User not found' });

  user.fcmTokens = Array.from(new Set([...(user.fcmTokens || []), token]));
  await user.save();

  res.status(200).json({
    success: true,
    data: 'Fcm token registered',
  });
});
