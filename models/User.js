import mongoose from 'mongoose';
import jwt from 'jsonwebtoken';

// const emailRegex = /^[A-Za-z0-9._%+-]+@(circuithouse\.tech|lumio\.co\.in)$/i;
const UserSchema = new mongoose.Schema({
  provider: {
    type: String,
    required: true,
    enum: ['google'], // for now only google, can add more later
  },
  providerId: {
    type: String,
    required: true,
    index: true,
  },
  name: {
    type: String,
    require: [true, 'Please add a name'],
  },
  role: {
    type: String,
    enum: ['admin', 'purchaser', 'owner', 'member'],
    default: 'member',
  },
  manager: String,
  profilePhotoUrl: { type: String },
  empId: {
    type: String,
    require: [true, 'Please add Employee id'],
  },
  isManager: { type: Boolean, default: false },
  phoneNumber: { type: String, default: '' },
  email: {
    type: String,
    required: [true, 'Email is required'],
    trim: true,
    lowercase: true,
    unique: true,
    // match: [emailRegex, 'Email must be at circuithouse.tech or lumio.co.in'],
  },
  fcmTokens: {
    type: [String],
    default: [],
  },
  lastLogin: {
    type: Date,
    default: Date.now,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

// Sign Access JWT and return
UserSchema.methods.getSignedAccessToken = function () {
  return jwt.sign({ id: this._id }, process.env.ACCESS_JWT_SECRET, {
    expiresIn: process.env.ACCESS_JWT_EXPIRE,
  });
};

// Sign Refresh JWT and return
UserSchema.methods.getSignedRefreshToken = function () {
  return jwt.sign({ id: this._id }, process.env.REFRESH_JWT_SECRET, {
    expiresIn: process.env.REFRESH_JWT_EXPIRE,
  });
};

// UserSchema.index({ provider: 1, providerId: 1 }, { unique: true });

export default mongoose.model('User', UserSchema);
