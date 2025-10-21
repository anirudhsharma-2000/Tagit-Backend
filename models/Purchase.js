import mongoose from 'mongoose';

const PurchaseSchema = new mongoose.Schema({
  assetName: { type: String },
  requiredBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  requestedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  manager: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
  },
  assetType: { type: String, required: true },
  managerApproval: { type: Boolean },
  assetUrl: { type: String },
  assetPrice: { type: Number },
  assestPurpose: { type: String },
  purchasedOn: { type: Date },
  requestStatus: { type: Boolean },
  requestCreatedAt: {
    type: Date,
    default: Date.now(),
  },
  requestAcceptedAt: { type: Date },
});

export default mongoose.model('Purchase', PurchaseSchema);
