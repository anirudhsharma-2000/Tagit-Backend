import mongoose from 'mongoose';

// Counter Schema
const CounterSchema = new mongoose.Schema({
  _id: { type: String, required: true }, // e.g., "asset"
  seq: { type: Number, default: 0 },
});

// Prevent overwrite in dev reloads
const Counter =
  mongoose.models.Counter || mongoose.model('Counter', CounterSchema);

// Asset Schema
const AssetSchema = new mongoose.Schema({
  chId: {
    type: String,
    unique: true,
  },
  name: { type: String, required: true },
  model: {
    type: String,
    required: [true, 'Please add a Model Number'],
  },
  desc: { type: String },
  transferable: { type: Boolean, required: true },
  assetState: {
    type: String,
    required: true,
    enum: [
      'Working',
      'Discarded',
      'Returned',
      'Under Repair',
      'Lost',
      'In Stock',
      'Reserved',
      'Maintenance',
      'Damaged',
      'Sold',
      'Other',
    ],
  },
  serialNo: {
    type: String,
    required: [true, 'Please add a Serial Number'],
  },
  warranty: {
    type: String,
    required: [true, 'Please add Warranty Date'],
  },
  invoiceAvailable: {
    type: Boolean,
    required: true,
  },
  invoiceUrl: { type: String },
  photoUrl: { type: String },
  purchaser: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  owner: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true,
  },
  deviceType: { type: String },
  allocation: {
    type: mongoose.Schema.ObjectId,
    ref: 'Allocation',
  },
  availablity: { type: Boolean },
  purchasedOn: { type: String },
});

// Pre-save hook to auto-generate chId
AssetSchema.pre('save', async function (next) {
  if (this.isNew && !this.chId) {
    const counter = await Counter.findByIdAndUpdate(
      { _id: 'asset' },
      { $inc: { seq: 1 } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    // Zero pad to 2 digits — adjust as needed (e.g., padStart(3) for 001, 002, 003)
    const formattedSeq = String(counter.seq).padStart(2, '0');

    this.chId = `ch/${formattedSeq}`;
  }
  next();
});

const Asset = mongoose.models.Asset || mongoose.model('Asset', AssetSchema);
export default Asset;
