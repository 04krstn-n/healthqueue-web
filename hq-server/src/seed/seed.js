/**
 * HealthQueue+ Master Seed Script
 * Run:  npm run seed
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose   = require('mongoose');
const bcrypt     = require('bcryptjs');

const User         = require('../models/User');
const Clinic       = require('../models/Clinic');
const Patient      = require('../models/Patient');
const Staff        = require('../models/Staff');
const FAQ          = require('../models/FAQ');
const SystemConfig = require('../models/SystemConfig');
const QueueEntry   = require('../models/QueueEntry');
const Appointment  = require('../models/Appointment');

// ── Helper ────────────────────────────────────────────────────────────────────
const svc = (name, desc, mins) => ({ name, description: desc, durationMinutes: mins, isAvailable: true });

// ── Clinic Data (all 8 branches) ──────────────────────────────────────────────
const CLINICS = [
  {
    name: 'Hi-Precision Diagnostics - Congressional',
    address: 'Congressional Ave, Project 8, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6625, longitude: 121.0335,
    contactNumber: '+63 2 8927-1111', email: 'congressional@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 80, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 10, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',      'CBC, urinalysis, blood chemistry, and other lab tests', 30),
      svc('Ultrasound',      'Abdominal, pelvic, and OB ultrasound',                  45),
      svc('Digital X-Ray',   'Chest, spine, and extremity digital radiography',       20),
      svc('ECG & Cardiology','12-lead ECG and cardiology screening',                  30),
      svc('Drug Testing',    'DOLE-accredited pre-employment drug test',              20),
      svc('Executive Health','Comprehensive annual executive health screening',       120),
    ],
    peakHours: [{hour:'08:00',load:50},{hour:'10:00',load:85},{hour:'12:00',load:95},{hour:'14:00',load:60},{hour:'16:00',load:45}],
  },
  {
    name: 'Hi-Precision Diagnostics - Del Monte',
    address: '442 Del Monte Ave, San Francisco del Monte, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6360, longitude: 121.0125,
    contactNumber: '+63 2 8374-1234', email: 'delmonte@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 60, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 12, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',             'Hematology, chemistry, and serology tests',   30),
      svc('Ultrasound',             'OB, abdominal, and thyroid ultrasound',        45),
      svc('Digital X-Ray',          'Chest PA and lateral views',                  20),
      svc('Executive Health',       'Annual executive health package',             120),
      svc('Mammography & Pap Smear',"Women's preventive health screening",          60),
    ],
    peakHours: [{hour:'08:00',load:40},{hour:'10:00',load:60},{hour:'12:00',load:70},{hour:'14:00',load:50},{hour:'16:00',load:80}],
  },
  {
    name: 'Hi-Precision Diagnostics - Quezon Avenue',
    address: 'Quezon Ave corner G. Araneta Ave, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6225, longitude: 121.0110,
    contactNumber: '+63 2 8741-7777', email: 'quezonavenue@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 6:00 PM',
    status: 'open', maxQueueCapacity: 100, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 15, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',             'Full laboratory panel including blood chemistry', 30),
      svc('Ultrasound',             'All types of diagnostic ultrasound',               45),
      svc('Digital X-Ray',          'Full-body digital radiography',                    20),
      svc('ECG & Cardiology',       'ECG, stress test, and Holter monitoring',          30),
      svc('CT Scan & MRI',          'Advanced cross-sectional imaging',                 60),
      svc('Executive Health',       'Comprehensive executive health screening',        120),
      svc('Mammography & Pap Smear',"Women's preventive care package",                  60),
    ],
    peakHours: [{hour:'08:00',load:30},{hour:'10:00',load:55},{hour:'12:00',load:65},{hour:'14:00',load:80},{hour:'16:00',load:55}],
  },
  {
    name: 'Hi-Precision Diagnostics - V. Luna',
    address: 'V. Luna Road corner Malumanay St, Diliman, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6335, longitude: 121.0495,
    contactNumber: '+63 2 8920-5555', email: 'vluna@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 60, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 8, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',      'Hematology and blood chemistry',           30),
      svc('Digital X-Ray',   'Chest and bone X-ray',                     20),
      svc('ECG & Cardiology','12-lead ECG and cardiac screening',         30),
      svc('Drug Testing',    'Pre-employment and random drug testing',    20),
    ],
    peakHours: [{hour:'08:00',load:75},{hour:'10:00',load:90},{hour:'12:00',load:100},{hour:'14:00',load:80},{hour:'16:00',load:85}],
  },
  {
    name: 'Hi-Precision Diagnostics - Banawe',
    address: 'Banawe St. corner N.S. Amoranto, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6310, longitude: 121.0020,
    contactNumber: '+63 2 8740-9999', email: 'banawe@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 70, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 10, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',      'CBC, urinalysis, and chemistry',    30),
      svc('Ultrasound',      'Abdominal and pelvic ultrasound',    45),
      svc('Digital X-Ray',   'Standard chest and bone X-ray',      20),
      svc('ECG & Cardiology','ECG and cardiovascular screening',    30),
      svc('Executive Health','Annual health screening package',    120),
    ],
    peakHours: [{hour:'08:00',load:45},{hour:'10:00',load:70},{hour:'12:00',load:80},{hour:'14:00',load:60},{hour:'16:00',load:75}],
  },
  {
    name: 'Hi-Precision Diagnostics - Retiro',
    address: 'N.S. Amoranto Sr. St, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6315, longitude: 121.0080,
    contactNumber: '+63 2 8415-8888', email: 'retiro@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 50, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 9, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',             'Standard blood and urine lab tests', 30),
      svc('Ultrasound',             'OB and general ultrasound',           45),
      svc('Digital X-Ray',          'Chest and extremity X-ray',           20),
      svc('Mammography & Pap Smear',"Women's health screening",            60),
    ],
    peakHours: [{hour:'08:00',load:35},{hour:'10:00',load:50},{hour:'12:00',load:75},{hour:'14:00',load:55},{hour:'16:00',load:60}],
  },
  {
    name: 'Hi-Precision Diagnostics - Congressional Extension',
    address: 'Congressional Ave Extension, Miranila, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6685, longitude: 121.0620,
    contactNumber: '+63 2 8352-2222', email: 'congressionalext@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 5:00 PM',
    status: 'open', maxQueueCapacity: 60, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 11, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',      'Complete blood count and chemistry panel', 30),
      svc('Digital X-Ray',   'Digital chest and bone radiography',        20),
      svc('ECG & Cardiology','ECG screening',                             30),
      svc('Executive Health','Comprehensive health package',             120),
    ],
    peakHours: [{hour:'08:00',load:40},{hour:'10:00',load:65},{hour:'12:00',load:85},{hour:'14:00',load:70},{hour:'16:00',load:50}],
  },
  {
    name: 'Hi-Precision Diagnostics - East Avenue',
    address: 'East Avenue, Diliman, Quezon City',
    city: 'Quezon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6405, longitude: 121.0450,
    contactNumber: '+63 2 8928-8888', email: 'eastavenue@hiprecision.com',
    facilityType: 'Diagnostic Center', operatingHours: '7:00 AM - 6:00 PM',
    status: 'open', maxQueueCapacity: 80, acceptsWalkIn: true, acceptsAppointment: true,
    baseWaitTimePerPerson: 14, queueLength: 0, currentWaitingTime: 0,
    services: [
      svc('Laboratory',     'Full laboratory workup',                          30),
      svc('Ultrasound',     'All types of ultrasound',                          45),
      svc('Digital X-Ray',  'Digital radiography — chest, spine, extremities',  20),
      svc('CT Scan & MRI',  'Advanced cross-sectional imaging services',         60),
      svc('Executive Health','Comprehensive executive health package',          120),
    ],
    peakHours: [{hour:'08:00',load:50},{hour:'10:00',load:80},{hour:'12:00',load:90},{hour:'14:00',load:75},{hour:'16:00',load:60}],
  },
];

// ── Users ─────────────────────────────────────────────────────────────────────
const USERS = [
  { fullName: 'Super Admin',    email: 'superadmin@hqplus.com',    phone: '+639000000001', password: 'Admin@1234',   role: 'super_admin',    isVerified: true, isActive: true },
  { fullName: 'Facility Admin', email: 'facilityadmin@hqplus.com', phone: '+639000000002', password: 'Admin@1234',   role: 'facility_admin', isVerified: true, isActive: true },
  { fullName: 'Staff Member',   email: 'staff@hqplus.com',         phone: '+639000000003', password: 'Staff@1234',   role: 'staff',          isVerified: true, isActive: true },
  { fullName: 'Juan Dela Cruz', email: 'patient@hqplus.com',       phone: '+639171234567', password: 'Patient@1234', role: 'patient',        isVerified: true, isActive: true },
  { fullName: 'Ana Reyes',      email: 'ana.reyes@gmail.com',      phone: '+639171111111', password: 'Patient@123',  role: 'patient',        isVerified: true, isActive: true },
  { fullName: 'Rosa Mendoza',   email: 'rosa.m@gmail.com',         phone: '+639173333333', password: 'Patient@123',  role: 'patient',        isVerified: true, isActive: true },
];

// ── FAQs ──────────────────────────────────────────────────────────────────────
const FAQS = [
  { question: 'How do I join the queue?',           answer: "Open the app, select your clinic and service, then tap 'Get Queue Number'. You'll receive a ticket with your position and estimated wait time.", category: 'queue' },
  { question: 'How do I book an appointment?',      answer: "Tap 'Book Appointment' on the dashboard, select your preferred clinic, service, date, and time slot.", category: 'appointment' },
  { question: 'Can I cancel my appointment?',       answer: "Yes. Go to the Appointments tab, find your booking, and tap 'Cancel Appointment'.", category: 'appointment' },
  { question: 'What is priority queue?',            answer: 'Priority queues are for senior citizens (60+), PWD, and pregnant women. Please present a valid ID at the clinic.', category: 'queue' },
  { question: 'How accurate is the wait time?',     answer: 'Wait times are estimated based on current queue length and average service time. Actual times may vary.', category: 'queue' },
  { question: 'What services are available?',       answer: 'Hi-Precision offers: Laboratory, Ultrasound, Digital X-Ray, ECG & Cardiology, CT Scan & MRI, Drug Testing, Executive Health, and Mammography & Pap Smear.', category: 'general' },
  { question: 'Which branches are open?',           answer: 'All 8 Hi-Precision branches in Quezon City are open: Congressional, Del Monte, Quezon Avenue, V. Luna, Banawe, Retiro, Congressional Extension, and East Avenue.', category: 'general' },
  { question: 'How do I contact a branch?',         answer: "Each branch contact number is shown in the clinic details on the app dashboard.", category: 'general' },
  { question: 'How does AI Suggest work?',          answer: 'AI Suggest scores nearby clinics by current queue load and estimated wait time to recommend the fastest available option near you.', category: 'general' },
  { question: 'Can I have multiple queue numbers?', answer: 'No. You can only have one active queue entry per clinic per day.', category: 'queue' },
];

// ── SystemConfig — key/value pairs matching the model schema ──────────────────
const SYSTEM_CONFIGS = [
  { key: 'system_name',               value: 'HealthQueue+',  label: 'System Name',                description: 'The name of the system',                        group: 'General'  },
  { key: 'system_version',            value: '2.0.0',         label: 'Version',                    description: 'Current system version',                         group: 'General'  },
  { key: 'maintenance_mode',          value: false,           label: 'Maintenance Mode',            description: 'Put the system in maintenance mode',             group: 'General'  },
  { key: 'allow_registration',        value: true,            label: 'Allow Registration',          description: 'Allow new patient self-registration',            group: 'General'  },
  { key: 'max_queue_per_user',        value: 1,               label: 'Max Queue Per User',          description: 'Max active queue entries per patient per day',   group: 'Queue'    },
  { key: 'default_wait_per_person',   value: 10,              label: 'Default Wait Time (min)',     description: 'Default estimated wait time per patient',        group: 'Queue'    },
  { key: 'chatbot_enabled',           value: true,            label: 'Chatbot Enabled',             description: 'Enable the AI chatbot assistant',               group: 'Chatbot'  },
];

// ── Seed ──────────────────────────────────────────────────────────────────────
async function seed() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('❌ MONGO_URI not set in .env'); process.exit(1); }

  await mongoose.connect(uri);
  console.log('✅ MongoDB connected\n');

  // 1. Clear all collections
  process.stdout.write('🗑️  Clearing all collections… ');
  await Promise.all([
    User.deleteMany({}),
    Clinic.deleteMany({}),
    Patient.deleteMany({}),
    Staff.deleteMany({}),
    QueueEntry.deleteMany({}),
    Appointment.deleteMany({}),
    FAQ.deleteMany({}),
    SystemConfig.deleteMany({}),
  ]);
  console.log('done\n');

  // 2. Clinics FIRST (needed for clinicId assignment)
  console.log('🏥 Seeding clinics…');
  const createdClinics = await Clinic.insertMany(CLINICS);
  createdClinics.forEach(c => console.log(`  ✓ ${c.name}`));
  const mainClinic = createdClinics[0];

  // 3. Users (with clinicId already assigned)
  console.log('\n👤 Seeding users…');
  const createdUsers = [];
  for (const u of USERS) {
    const clinicId = (u.role === 'facility_admin' || u.role === 'staff') ? mainClinic._id : null;
    const user = await User.create({ ...u, clinicId });
    createdUsers.push(user);
    console.log(`  ✓ [${user.role}] ${user.email}`);
  }

  // 4. Patient profiles
  console.log('\n🩺 Seeding patient profiles…');
  for (const u of createdUsers.filter(u => u.role === 'patient')) {
    await Patient.create({ user: u._id, fullName: u.fullName, email: u.email, phone: u.phone, patientType: 'Regular' });
    console.log(`  ✓ ${u.fullName}`);
  }

  // 5. Staff profile
  console.log('\n👨‍⚕️ Seeding staff profile…');
  const staffUser = createdUsers.find(u => u.role === 'staff');
  if (staffUser) {
    await Staff.create({
      user: staffUser._id, clinic: mainClinic._id,
      fullName: staffUser.fullName, email: staffUser.email, phone: staffUser.phone,
      role: 'admin', position: 'Receptionist', isActive: true,
    });
    console.log(`  ✓ ${staffUser.fullName} → ${mainClinic.name}`);
  }

  // 6. FAQs
  console.log('\n💬 Seeding FAQs…');
  await FAQ.insertMany(FAQS.map(f => ({ ...f, isActive: true })));
  console.log(`  ✓ ${FAQS.length} FAQs`);

  // 7. SystemConfig — insert as individual key/value documents
  console.log('\n⚙️  Seeding system config…');
  await SystemConfig.insertMany(SYSTEM_CONFIGS);
  console.log(`  ✓ ${SYSTEM_CONFIGS.length} config entries`);

  // 8. Verify password hashes
  console.log('\n🔐 Verifying password hashes…');
  let allOk = true;
  for (const u of USERS) {
    const saved = await User.findOne({ email: u.email }).select('+password');
    const ok    = await bcrypt.compare(u.password, saved.password);
    console.log(`  ${ok ? '✓' : '✗ HASH MISMATCH!'} ${u.email}`);
    if (!ok) allOk = false;
  }
  if (!allOk) {
    console.error('\n❌ Password hash check failed!');
    process.exit(1);
  }

  // Done
  console.log('\n' + '─'.repeat(55));
  console.log('🎉 Seed complete!\n');
  console.log('📋 Login credentials:');
  console.log('  Super Admin    → superadmin@hqplus.com    / Admin@1234');
  console.log('  Facility Admin → facilityadmin@hqplus.com / Admin@1234');
  console.log('  Staff          → staff@hqplus.com         / Staff@1234');
  console.log('  Patient        → patient@hqplus.com       / Patient@1234');
  console.log('─'.repeat(55));
  console.log(`\n  Clinics seeded:   ${createdClinics.length}`);
  console.log(`  Users seeded:     ${createdUsers.length}`);
  console.log(`  Facility Admin → ${mainClinic.name}`);

  await mongoose.disconnect();
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message);
  process.exit(1);
});
