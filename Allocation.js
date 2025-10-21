import mongoose from 'mongoose';

const AllocationSchema = new mongoose.Schema(
  {
    allocatedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    allocatedTo: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },
    allocatedRequestDate: {
      type: Date,
      default: Date.now,
    },
    asset: {
      type: mongoose.Schema.ObjectId,
      ref: 'Asset',
      required: true,
    },
    purpose: { type: String },
    allocationType: {
      type: String,
      required: [true, 'Please provide allocation type'],
    },

    // legacy boolean for quick checks (kept for backward compatibility)
    requestStatus: { type: Boolean },

    // clearer status enum: 'pending' | 'approved' | 'rejected'
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'completed'],
      default: 'pending',
      index: true,
    },

    // who approved the allocation (if approved)
    approvedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
    },

    // optional reason for rejection
    rejectionReason: {
      type: String,
    },

    // when request was accepted/rejected/processed
    allocationStatusDate: { type: Date },

    duration: {
      startTime: { type: String },
      endTime: { type: String },
    },
  },
  {
    timestamps: true, // adds createdAt and updatedAt
  }
);

export default mongoose.model('Allocation', AllocationSchema);
