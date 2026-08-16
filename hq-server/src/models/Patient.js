/**
 * Patient profile model (linked to a User account)
 */
const mongoose = require('mongoose');

const PatientSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
      index: true,
    },
    fullName:         { type: String, required: true, trim: true },
    dateOfBirth: {
  type: Date,
  default: null,
},
    age:              { type: Number, default: null },
    gender: {
      type: String,
      enum: ['Male', 'Female', 'Other', ''],
      default: '',
    },
    phone:            { type: String, default: '', trim: true },
    email:            { type: String, default: '', lowercase: true, trim: true },
    address:          { type: String, default: '' },
    philHealthNumber: { type: String, default: '' },
    hmoProvider:      { type: String, default: '' },
    patientType: {
      type: String,
      enum: ['Regular', 'Senior Citizen', 'PWD', 'Pregnant', 'Priority'],
      default: 'Regular',
    },
    bloodType: {
      type: String,
      enum: ['A+','A-','B+','B-','AB+','AB-','O+','O-','Unknown',''],
      default: '',
    },
    allergies:    { type: String, default: '' },
    medicalNotes: { type: String, default: '' },
    isActive:     { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Patient', PatientSchema);