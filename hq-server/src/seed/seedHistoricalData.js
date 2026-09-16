/**
 * HealthQueue+ — Historical Mock Data Seed Script
 * ------------------------------------------------
 * Run:  node src/seed/seedHistoricalData.js
 *
 * WHAT THIS DOES
 *  1. Upserts your 5 real Malabon City clinics (by name, so this is safe
 *     to re-run) and a System Admin account (by email). Does NOT depend
 *     on `npm run seed` having been run — this script is fully
 *     self-sufficient. No healthcare staff or facility_admin accounts are
 *     created — System Admin is the only non-patient account this script
 *     produces, and is also the actor attributed to all staff-side
 *     actions (queue calls, completions, appointment updates, etc.) in
 *     the generated audit log.
 *  2. Creates new patient accounts (User + matching Patient profile) from
 *     the NAMES list below. Registration dates randomized within
 *     REG_START..REG_END.
 *  3. Generates historical QueueEntry and Appointment documents dated
 *     HIST_START..HIST_END, with RANDOMIZED daily volume per clinic —
 *     including simulated typhoon / heavy-rain days where volume drops
 *     and cancellations/no-shows spike.
 *  4. Generates chatbot conversations (ChatLog + ChatSession), but ONLY
 *     within CHAT_START..CHAT_END. ChatLog has a 7-day TTL index in your
 *     schema — anything older than ~7 days from "today" gets auto-deleted
 *     by MongoDB almost immediately, so seeding chat history further back
 *     than that would just vanish on its own. Conversations are bot-only
 *     (isEscalated: false throughout) so none of them surface in any
 *     staff-side escalation queue.
 *  5. Generates Notifications (registration welcome, queue/appointment
 *     lifecycle events) across the full HIST range.
 *  6. Generates AuditLog entries (queue/appointment actions, and
 *     admin-side account/clinic lifecycle events) across the full HIST
 *     range, all attributed to the System Admin account.
 *
 * Writes directly to raw MongoDB collections (bypassing Mongoose hooks)
 * for full control over _id, timestamps, and the pre-hashed password.
 *
 * SAFE TO RE-RUN? Clinics and the System Admin account are upserted, so
 * those are safe. Patients, queue/appointment/chat/notification/audit
 * history are NOT — re-running duplicates them. Intended for a single
 * run against a fresh dev DB.
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const mongoose = require('mongoose');
const { ObjectId } = mongoose.Types;

const bcrypt = require('bcryptjs');
const Clinic = require('../models/Clinic');

// ── CONFIG ──────────────────────────────────────────────────────────────────
const PATIENT_PASSWORD_HASH = '$2a$12$NyWTJ6tYbH9cNzSEtL6iCe2e8NEnGiDJeyEp6bkTG.YiRQDNCPwXy';

// Patient account registration window
const REG_START = new Date('2026-08-27T00:00:00.000Z');
const REG_END   = new Date('2026-09-11T23:59:59.000Z');

// Historical queue/appointment/notification/audit-log activity window
const HIST_START = new Date('2026-08-27T00:00:00.000Z');
const HIST_END   = new Date('2026-09-11T23:59:59.000Z');

// ChatLog window — kept narrow on purpose (see note above re: 7-day TTL).
// "Today" in this environment is 2026-09-16, so only the last ~7 days of
// the historical range would survive anyway.
const CHAT_START = new Date('2026-09-09T00:00:00.000Z');
const CHAT_END   = new Date('2026-09-11T23:59:59.000Z');

// System Admin (super_admin) account to create/upsert.
const SYSTEM_ADMIN = {
  fullName: 'System Admin',
  email: 'healthqueueorg@gmail.com',
  plainPassword: 'healthqueue*PFG2025', // hashed at runtime below with bcryptjs (10 rounds), matching User.js's own hashing
};

// ── CLINICS (your 5 real Malabon City branches) ────────────────────────────
// Upserted by name — safe to re-run. Coordinates are approximate (central
// Malabon City with a small per-clinic offset) since none were provided;
// swap in exact lat/lng if you have them for accurate map/geo-radius use.
const svc = (name, mins) => ({ name, description: '', durationMinutes: mins, isAvailable: true });
const CLINICS_SEED = [
  {
    name: 'St. Jude Medical Clinic & Diagnostic Center',
    address: 'RLN Centre Bldg., M.H. Del Pilar Corner Gov. Pascual Ave., Catmon, Malabon City',
    city: 'Malabon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6602, longitude: 120.9540,
    contactNumber: '09171270542', email: '',
    facilityType: 'Medical Clinic & Diagnostic Center',
    operatingHours: '7:00 AM - 7:00 PM (Daily)',
    acceptsWalkIn: true, acceptsAppointment: true, maxQueueCapacity: 100, baseWaitTimePerPerson: 12,
    services: [
      svc('Laboratory Tests', 20),
      svc('Ultrasound', 30),
      svc('ECG', 15),
      svc('Xray', 15),
      svc('Drug Test', 15),
      svc('Pre-Natal Check-up', 30),
    ],
  },
  {
    name: 'Cherry Lab Diagnostic & Medical Inc.',
    address: '#12 Lot 6 AK-XYZ Bldg. 2/F, Governor Pascual Ave., Acacia, Malabon City',
    city: 'Malabon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6588, longitude: 120.9555,
    contactNumber: '09152811232', email: 'cldmc2012@yahoo.com',
    facilityType: 'Diagnostic Laboratory',
    operatingHours: 'Mon-Sat: 7:00 AM - 5:00 PM, Sun: 7:00 AM - 12:00 PM',
    acceptsWalkIn: true, acceptsAppointment: true, maxQueueCapacity: 80, baseWaitTimePerPerson: 10,
    services: [
      svc('Complete Blood Count', 15),
      svc('Blood Chemistry Panel', 20),
      svc('Urinalysis & Stool Exam', 15),
      svc('Serology & Immunology', 20),
      svc('Cardiac Markers', 20),
      svc('Pre-Employment Packages', 45),
      svc('Pregnancy & OB Panel', 30),
      svc('Medical Consultation', 20),
    ],
  },
  {
    name: 'Malabon Polymedic Multi Specialty Clinic',
    address: '186 Gov. Pascual Ave., Malabon City',
    city: 'Malabon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6575, longitude: 120.9548,
    contactNumber: '(02) 8287 9168', email: '',
    facilityType: 'Multi-Specialty Clinic',
    operatingHours: 'Mon-Sun: 8:30 AM - 6:00 PM',
    acceptsWalkIn: true, acceptsAppointment: true, maxQueueCapacity: 90, baseWaitTimePerPerson: 15,
    services: [
      svc('Pediatrics', 20),
      svc('Ob-gyne', 20),
      svc('Internal Medicine', 20),
      svc('Ophthalmology', 20),
      svc('General Medicine', 15),
      svc('Surgery', 60),
    ],
  },
  {
    name: 'PolyHealth Diagnostic and Laboratory Inc',
    address: 'Cenel Place, #239 Gen. Luna, cor Burgos St, Brgy. Concepcion, Malabon City',
    city: 'Malabon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6561, longitude: 120.9532,
    contactNumber: '(02) 8252 9000', email: 'inquiry.polyhealth@gmail.com',
    facilityType: 'Diagnostic & Laboratory Center',
    operatingHours: 'Mon-Sat: 7:00 AM - 7:00 PM, Sun: 7:00 AM - 5:00 PM',
    acceptsWalkIn: true, acceptsAppointment: true, maxQueueCapacity: 120, baseWaitTimePerPerson: 12,
    services: [
      svc('Laboratory Procedures', 20),
      svc('Dental Procedures', 30),
      svc('Medical Packages', 45),
      svc('Executive Check-up Packages', 60),
      svc('Pre-Employment Exam Packages', 45),
      svc('Annual Physical Exam', 45),
      svc('Radiology & Imaging', 30),
      svc('Cardiac Services', 30),
      svc('Pulmonary Services', 30),
      svc('Home Service', 60),
      svc('Hearing Tests', 20),
      svc('Mobile Clinic', 30),
    ],
  },
  {
    name: 'St. Anthony Diagnostic and Specialty Center',
    address: '326 Gen. Luna St, Malabon City',
    city: 'Malabon City', province: 'Metro Manila', region: 'NCR',
    latitude: 14.6555, longitude: 120.9529,
    contactNumber: '0920572974', email: '',
    facilityType: 'Diagnostic & Specialty Center',
    operatingHours: 'Mon-Sat: 6:30 AM - 3:30 PM',
    acceptsWalkIn: true, acceptsAppointment: true, maxQueueCapacity: 80, baseWaitTimePerPerson: 12,
    services: [
      svc('Laboratory Tests', 20),
      svc('Xray', 15),
      svc('ECG', 15),
      svc('Ultrasound', 30),
      svc('2D Echo', 30),
      svc('Medical Services', 20),
      svc('Dental Services', 30),
    ],
  },
];

// ── NAMES (patients) ────────────────────────────────────────────────────────
const NAMES = [
  "Jan Erick Barles",
  "Bryle Racel Bayola",
  "Jhonnie Maongco",
  "John Kylle Santos",
  "Maria Bea Nicole Mendoza",
  "Kyrvin Roque",
  "Marcellus Salcedo",
  "Jannah Peralta",
  "Lara Alia Gallego",
  "Aaron Grefalda",
  "Vinz Gabriel Garcia",
  "Joshua Enquilino",
  "Ira Sofia Bueno",
  "Carlo Dominic Badilla",
  "Mark Ryan Bautista",
  "Rommel Sansano",
  "Jepeld Pablo",
  "Joebert Baldovia",
  "Cecilia Intino",
  "Julian Lansang",
  "Renz Andrei Ignacio",
  "Angela Julie Beltran",
  "Edcel John Bituin",
  "Mark Angelo De Guzman",
  "Bianca Louise Cruz",
  "John Patrick Sevilla",
  "Katrina Isabel Lim",
  "Cedric Paul Valencia",
  "Rhianne Kate Dela Cruz",
  "Gabriel Luis De Leon",
  "Angel Nicole De Jesus",
  "Vincent Kyle Magat",
  "Clarisse Anne Mercado",
  "Rafael Antonio Trinidad",
  "Danielle Marie Pineda",
  "John Kenneth Umali",
  "Samantha Louise Garcia",
  "Adrian Kyle Santos",
  "Patricia Anne Lozano",
  "Dominic Rafael Macaraeg",
  "Angelica Mae Soriano",
  "Kenneth Paul Domingo",
  "Mikaela Jane Salvador",
  "Dave Christian Cortez",
  "Stephanie Nicole Balagtas",
  "Gian Carlo Valerio",
  "Janna Patricia Fernandez",
  "Russell Troy Camacho",
  "Bea Bianca Tolentino",
  "John Vincent Legaspi",
  "Danica Rose Francisco",
  "Karl Angelo Santiago",
  "Erica Nicole Salazar",
  "Francis Miguel Singh",
  "Ella Sophia Castaneda",
  "Mark Lester Bernardo",
  "Nicole Anne Bartolome",
  "Carlo Angelo Del Rosario",
  "Trisha Mae Samonte",
  "Ivan Matthew Custodio",
  "Jasmine Claire Arceo",
  "Renz Marion Villanueva",
  "Lianne Patricia Bravo",
  "Christopher Ian Reyes",
  "Paul Christian Vinuya",
  "Charisse Mae Morales",
  "John Carlo Evangelista",
  "Alyssa Marie Dimaculangan",
  "Rovic James Serrano",
  "Julia Reese Montemayor",
  "Jared Matthew David",
  "Liezel Mae Palad",
  "Matthew David Arellano",
  "Jeslyn Kate De Castro",
  "Anthony Dave Manalo",
  "Bea Lorraine Ramos",
  "Sean Patrick Velasco",
  "Julianne Nicole Fajardo",
  "Christian Dave Alcantara",
  "Elaiza Marie Banal",
  "Jericho Kyle Beltran",
  "Christine Joy Aguilar",
  "Edrian James Mallari",
  "Princess Nicole Marquez",
  "Daniel Joshua Ocampo",
  "Gabrielle Marie Rivera",
  "Jeffrey John Magpantay",
  "Kimberly Anne Solis",
  "Earl Justin Pascual",
  "Sophia Marie Alvares",
  "Lance Christian Gomez",
  "Jervin Louise Caraan",
  "Zandro Luis Carpio",
  "Kristine Joy Esguerra",
  "Jaypee Allanic",
  "Aileen Joy Villanueva",
  "Joshua Miguel Tan",
  "Ma. Cristina Valenzuela",
  "Aldrich Jerlo Lacon",
  "Louise Gabriel Cabrera",
  "Carl Vincent Navarro",
  "Maria Angela Natividad",
  "Vince Andrei Soriano",
  "Hannah Grace Sebastian",
  "John Mark Dizon",
  "Justine Mae Quinto",
  "Gerald Anthony Lara",
  "Marc Anthony Salonga",
  "Patrick Jerome Pangilinan",
  "Angelo James Bautista",
  "Rainiel Geronimo",
  "Justin Carl Valderama",
  "Kevin Roy Alarcon",
  "Nino Rafael De Mesa",
  "Lawrence Dale Javier",
  "Mark Christian Rosales",
  "Kenn Jiro Agustin",
  "Raymond Joseph Mallari",
  "Ethan Gabriel Roxas",
  "John Andrei Guinto",
  "Ian Gabriel Aquino",
  "John Benedict Sison",
  "Ezekiel John Cai\u00f1a",
  "Keith Allen Cordero",
  "Aaron Paul Mendoza",
  "Rochelle Ann Macaspac",
  "Nathan Gabriel Espiritu",
  "Chloe Danielle Perez",
  "Mark Louie Crisostomo",
  "Mary Joy Balingit",
  "Kurt Russell Manansala",
  "Angela Nicole Galang",
  "Christian Dale Ofrasio",
  "Patricia Mae Dimayuga",
  "Dexter James Cayabyab",
  "Kimberly Rose Tria",
  "Sean Michael Arboleda",
  "Venice Lorraine Baluyot",
  "Ralph Joseph Marasigan",
  "Lyka Marie Samson",
  "Joshua Miguel Alcantara",
  "Jenny Rose Del Fierro",
  "Paolo Miguel Villafuerte",
  "Christine Joy Dimaano",
  "Andrei Kyle Magallanes",
  "Camille Ann Buenaventura",
  "Lean Carl Barrameda",
  "Shiela May Panganiban",
  "Brian Joshua Celo",
  "Denise Claire Salonga",
  "Miguel Angelo Torralba",
  "Princess Lea Guinto",
  "Charles Anthony Maglalang",
  "Kathleen Joy Belmonte",
  "Jerome Paul Esguerra",
  "Alyssa Faye Quimpo",
  "Justin Carlo Magsaysay",
  "Hannah Louise Calalang",
  "Darwin James De Roxas",
  "Bea Nicole Mananghaya",
  "Mark Dennis Legaspi",
  "Angelica Faith Palomar",
  "Kevin Matthew Abadilla",
  "Nicole Dianne Basco",
  "Lance Edward Valderrama",
  "Hazel Grace Capistrano",
  "Prince Allen Montano",
  "Andrea Sophia Datu",
  "Gerald Christian Balagtas",
  "Joyce Ann Villacorta",
  "Marvin Luis Catacutan",
  "Samantha Joy Macatangay",
  "Elijah James Paguio",
  "Kristine Bernadette Tan",
  "Kyle Vincent Almeda",
  "Mariel Therese David",
  "Patrick Ian Sumulong",
  "Joanne Marie Malabanan",
  "Neil Christian Banal",
  "Rina Isabel Guce",
  "Rommel Jay Pineda",
  "Sarah Mae Cabiles",
  "Justine Mark Punzalan",
  "Mary Grace Dizon",
  "Tristan James Balinghasay",
  "Kaye Celine Alcaraz",
  "Adrian Paul Sunga",
  "Cheska Marie Villalon",
  "John Philip Mendiola",
  "Althea Mae Cari\u00f1o",
  "Gabriel Antonio Lantin",
  "Diane Rose Balingit",
  "Ronald Christian Ebreo",
  "Janelle Louise Cordero",
  "Eric Daniel Macaraig",
  "Stephanie Joy Gatus",
  "Raymond Dale Villarama",
  "Queenie Claire Mangahas",
  "Francis Neil Soliman",
  "Jasmine Kate Agapito",
  "John David Parungao",
  "Paula Bianca Magbanua",
  "Ian Christopher Tolentino",
  "Melanie Rose Alarcon",
  "Jeffrey Carl Manalo",
  "Allyson Mae De Castro",
  "Lorenzo Gabriel Puno",
  "Daisy Jane Balcita",
  "Christopher Jan Mendoza",
  "Rica Joyce Tolentino",
  "Matthew James De Chavez",
  "Angelica Therese Cruz",
  "Ryan Christian Salazar",
  "Judy Ann Villareal",
  "Vincent Paul Magno",
  "Charisse Diane Aquino",
  "Kenneth Lloyd Arrieta",
  "Nicole Louise Mallari",
  "Angelo Miguel Carandang",
  "Glaiza Marie Batac",
  "Marco Daniel San Diego",
  "Ella Rose Villanueva",
  "Christian Rosario",
  "Jay Dizon",
  "Alfred Dela Cruz",
  "Sly Juan",
  "Justine Abalos",
  "Victor Sicuan",
  "Sandra Bautista",
  "Carl Albert Durian",
  "Raphael Bauag",
  "Jocelyn Loney",
  "Rhia Glenda Estocado",
  "Arkin Justine Pabilada",
  "Estella Ollero",
  "Tisha Iya Ojo",
  "Michelle Ace Aguilada",
  "Mary Claire Bardaje",
  "Meahgan Renee Feudo",
  "Alyka Brithany Lomoljo",
  "Sofia Binez",
  "Feny Denise Arellano",
  "Althea Buragay",
  "Marielle Charlize Diamse",
  "Ren Ren Agustin",
  "Thea Uy",
  "Denise Aleta",
  "Khianne Ong",
  "Lea May Cabales",
  "Ma. Arabella Valerio",
  "John Bernard Salangsang",
  "Kent Remandaban",
  "Clarice Bianca Obispo",
  "Alex Angela Agtuca",
  "Gian Carlos Rufon",
  "Maria Pauline Venice Miguel",
  "Vincent Reyes",
  "Cyrus Dural",
  "Michelle Rabino",
  "Kennidy Del Rosario",
  "Kristopher Aguda",
  "James Louie Cahambing",
  "Kyla Pallaya",
  "Natasha Nicole Apolonio",
  "Kaia Simon",
  "Ehvan Clemente",
  "Jeremiah Pineda",
  "Trisha Mhae Julian",
  "Bhreant Angelo Duque",
  "Ian Christian Villamin",
  "Rhea Erencio",
  "Marx Von Dela Cruz",
  "Rosmina Eleptico",
  "Trixie Joy Padayhag",
  "Angel Jeane Cabangis",
  "Catherin Joy Clamor",
  "Isaac Rosario",
  "Jashey Mae Sumala",
  "Marc Oliveros",
  "Alfredo Roxas",
  "Ella-May Arceo",
  "Felix Nathaniel Agpalza",
  "Arnel Teves",
  "Rebecca Cunan",
  "Rolly Casem",
  "Perlita Arkaina",
  "Tanya Febrero",
  "Eduard Clark Cabangis",
  "Yuri Geane Santiago",
  "Shang Clamor",
  "J Lee Hare Papa",
  "Trishia Mae Aquino",
  "Clark Sicam",
  "Apple Pereja",
  "Jonah Jimenez",
  "Charm Umali",
  "Yves Juniosa",
  "Jeann Francisco",
  "Jesicah Sumala",
  "Shalaika Ludana",
  "Aizagay Agpalza",
  "PJ Dela Cruz",
  "Chris Bolera",
  "Leovi Sarion",
  "Rochelle Dimayuga",
  "Ruth Tihim",
  "Ann Quiroz",
  "Lovely Andrea Saclolo",
  "Jose Padios",
  "Shamsherai Ysiah Pette",
  "Iza Dischoso",
  "Adrian Aragon",
  "Danilla Infante",
  "Mikaela Dela Cruz",
  "Kristine Guillermo",
  "Kayla Guinto",
  "Kenna Estella",
  "Cheska Relleta",
  "Kathleen Reyes",
  "Angela Boquio",
  "Kathy Rosendo",
  "Sopie Rorgador",
  "Mary Denise Padilla",
  "Ace Pe\u00f1averde",
  "Pia Basir",
  "Gwen Venus",
  "Abigail Ty",
  "Ellie Indon",
  "Bea Buena",
  "Nicole Isidro",
  "Kathleen Jardinan",
  "Kristel Soriano",
  "Cheska Salvador",
  "Ivan Miguel Papasin",
  "Julia Manalang",
  "Stephanie Jagolingay",
  "Justin de Guzman",
  "Nicole Rosal",
  "Mhark Joshua Torres",
  "Ivan Empleo",
  "Gloria Ting",
  "Rose Elisse Pacla",
  "Daven Revilla",
  "Jouana Marie Alfonso",
  "Leizel Luce\u00f1o",
  "Trishia Cruz",
  "Richard Asidillo Zarate",
  "Adrian Caguioa",
  "Danica Mesina",
  "Carlo Policarpio",
  "Jhonel Miranda Gonzales",
  "Christian Emmanuel Orocay",
  "Louie Domingo",
  "Renz Tolosa",
  "Gian Ubi\u00f1a",
  "Jules Vincent Columna",
  "Marc Justine Marcelo",
  "Kimberly Anne Paulo",
  "Gianne Rennel Bautista",
  "Julina Ortega",
  "Ashley Salcedo",
  "Ronalei Poyaoan",
  "Johanna Joyce Ilang",
  "Sean Arcadio",
  "Nichole Tolentino",
  "Princess Mariano",
  "Aaron Russell Sibulboro",
  "Jihan De Quiroz",
  "Karen Dela Cruz",
  "John Carlo Padre",
  "Jermain Allan Bok",
  "Fatima Necesario",
  "Troy Mansilungan",
  "Chastin Dela Torre",
  "Manuel Salvador",
  "Maria Mesina",
  "Janelle Fiona Esplana",
  "Rhenzy Reyes",
  "Wackine Lopez",
  "Rojella Santos",
  "Ysabel Caryl Yu",
];

// ── Small helpers ───────────────────────────────────────────────────────────
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const choice = (arr) => arr[randInt(0, arr.length - 1)];
const weightedChoice = (weights) => {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (const [key, w] of Object.entries(weights)) {
    if (r < w) return key;
    r -= w;
  }
  return Object.keys(weights)[0];
};
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(0, i);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
const daysBetween = (start, end) => {
  const out = [];
  const d = new Date(start);
  d.setUTCHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setUTCHours(0, 0, 0, 0);
  while (d <= endDay) {
    out.push(new Date(d));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};
const randomTimeOnDay = (day, startHour = 7, endHour = 17) => {
  const t = new Date(day);
  t.setUTCHours(randInt(startHour, endHour - 1), choice([0, 15, 30, 45]), randInt(0, 59), 0);
  return t;
};
const addMinutes = (date, mins) => new Date(date.getTime() + mins * 60000);
const pad3 = (n) => String(n).padStart(3, '0');

const usedEmails = new Set();
const usedPhones = new Set();
const toEmail = (fullName) => {
  const base = fullName.toLowerCase().replace(/[^a-z\s]/g, '').trim().split(/\s+/).join('.');
  let email, tries = 0;
  do {
    const suffix = tries === 0 ? randInt(100, 999) : randInt(1000, 9999);
    email = `${base}${suffix}@gmail.com`;
    tries++;
  } while (usedEmails.has(email));
  usedEmails.add(email);
  return email;
};
const toPhone = () => {
  let phone;
  do {
    phone = '09' + String(randInt(0, 999999999)).padStart(9, '0');
  } while (usedPhones.has(phone));
  usedPhones.add(phone);
  return phone;
};

// ── Chatbot conversation content bank ───────────────────────────────────────
const CHAT_TURNS = [
  { message: 'How do I join the queue?', reply: "Open the app, select your clinic and service, then tap 'Get Queue Number'. You'll get a ticket with your position and estimated wait time.", intent: 'faq_join_queue', source: 'faq' },
  { message: 'How do I book an appointment?', reply: "Tap 'Book Appointment' on the dashboard, select your preferred clinic, service, date, and time slot.", intent: 'faq_book_appointment', source: 'faq' },
  { message: 'Can I cancel my appointment?', reply: "Yes. Go to the Appointments tab, find your booking, and tap 'Cancel Appointment'.", intent: 'faq_cancel_appointment', source: 'faq' },
  { message: 'What is priority queue?', reply: 'Priority queues are for senior citizens (60+), PWD, and pregnant patients. Please present a valid ID at the clinic.', intent: 'faq_priority_queue', source: 'faq' },
  { message: 'How accurate is the wait time?', reply: 'Wait times are estimated from current queue length and average service time. Actual times may vary.', intent: 'faq_wait_accuracy', source: 'faq' },
  { message: 'Is the clinic open today because of the weather?', reply: 'Some branches may have adjusted hours due to weather. Please check the clinic status on the app before heading out.', intent: 'faq_weather_status', source: 'rasa' },
  { message: 'Can I still get a queue number if it is raining hard?', reply: 'Yes, as long as the clinic shows "open" on the app. Stay safe on your way over.', intent: 'faq_weather_queue', source: 'rasa' },
  { message: 'What time does the clinic close?', reply: 'Operating hours are shown on the clinic details page in the app — they can vary by branch.', intent: 'faq_hours', source: 'faq' },
  { message: 'Can I have multiple queue numbers?', reply: 'No, only one active queue entry per clinic per day is allowed.', intent: 'faq_multiple_queue', source: 'faq' },
];

async function main() {
  const uri = process.env.MONGO_URI;
  if (!uri) { console.error('\u274c MONGO_URI not set in .env'); process.exit(1); }
  await mongoose.connect(uri);
  console.log('\u2705 MongoDB connected\n');

  const db = mongoose.connection.db;

  // ── 1. Upsert the 5 real clinics ──────────────────────────────────────────
  console.log('\ud83c\udfe5 Upserting your 5 clinics…');
  const clinics = [];
  for (const c of CLINICS_SEED) {
    const doc = await Clinic.findOneAndUpdate(
      { name: c.name },
      {
        $set: {
          ...c,
          location: { type: 'Point', coordinates: [c.longitude, c.latitude] },
          status: 'open', isActive: true,
        },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
    clinics.push(doc);
  }
  console.log(`  \u2713 ${clinics.length} clinics ready: ${clinics.map((c) => c.name).join(', ')}`);

  // ── 1b. Upsert the System Admin account ───────────────────────────────────
  console.log('\n\ud83d\udee1\ufe0f  Upserting System Admin account…');
  const adminHash = await bcrypt.hash(SYSTEM_ADMIN.plainPassword, 10);
  await db.collection('users').updateOne(
    { email: SYSTEM_ADMIN.email },
    {
      $set: {
        fullName: SYSTEM_ADMIN.fullName, email: SYSTEM_ADMIN.email, password: adminHash,
        role: 'super_admin', clinicId: null, fcmToken: null, otp: null, otpExpires: null,
        isVerified: true, isActive: true, gender: 'Prefer not to say', specialization: '',
        updatedAt: new Date(),
      },
      $setOnInsert: { _id: new ObjectId(), createdAt: new Date(), __v: 0 },
    },
    { upsert: true }
  );
  console.log(`  \u2713 System Admin ready: ${SYSTEM_ADMIN.email}`);
  const systemAdmin = await db.collection('users').findOne({ email: SYSTEM_ADMIN.email });

  // ── 2. Build patient Users + Patient profiles ──────────────────────────────
  console.log(`\n\ud83d\udc64 Building ${NAMES.length} patient accounts…`);
  const userDocs = [];
  const patientDocs = [];
  const patientPool = [];

  const NON_SENIOR_TYPE_WEIGHTS = { Regular: 80, PWD: 5, Pregnant: 4, Priority: 3 };
  const calcAge = (dob, asOf) => {
    let age = asOf.getUTCFullYear() - dob.getUTCFullYear();
    const hadBirthdayYet = (asOf.getUTCMonth() > dob.getUTCMonth()) ||
      (asOf.getUTCMonth() === dob.getUTCMonth() && asOf.getUTCDate() >= dob.getUTCDate());
    if (!hadBirthdayYet) age--;
    return age;
  };
  const TODAY = new Date(); // real "now" — age is computed the same way the live app would compute it

  for (const fullName of NAMES) {
    const _id = new ObjectId();
    const gender = choice(['Male', 'Female']);
    const email = toEmail(fullName);
    const phone = toPhone();
    const createdAt = new Date(randInt(REG_START.getTime(), REG_END.getTime()));
    const updatedAt = addMinutes(createdAt, randInt(0, 60));

    const dateOfBirth = new Date(Date.UTC(randInt(1955, 2007), randInt(0, 11), randInt(1, 28)));
    const age = calcAge(dateOfBirth, TODAY);
    // Age > 60 is always tagged Senior Citizen (and therefore priority — see
    // isPriorityPatient below); everyone else gets the usual random mix.
    const patientType = age > 60 ? 'Senior Citizen' : weightedChoice(NON_SENIOR_TYPE_WEIGHTS);

    userDocs.push({
      _id, fullName, email, phone, fcmToken: null, password: PATIENT_PASSWORD_HASH,
      role: 'patient', clinicId: null, otp: null, otpExpires: null,
      isVerified: true, isActive: true, gender, specialization: '',
      createdAt, updatedAt, __v: 0,
    });

    patientDocs.push({
      _id: new ObjectId(), user: _id, fullName,
      dateOfBirth,
      age: null, gender, phone, email, address: '', philHealthNumber: '', hmoProvider: '',
      patientType, bloodType: '', allergies: '', medicalNotes: '', isActive: true,
      createdAt, updatedAt, __v: 0,
    });

    patientPool.push({ _id, fullName, phone, email, patientType });
  }

  await db.collection('users').insertMany(userDocs);
  await db.collection('patients').insertMany(patientDocs);
  console.log(`  \u2713 ${userDocs.length} users + ${patientDocs.length} patient profiles inserted`);

  // ── 3. Decide weather per day ──────────────────────────────────────────────
  const allDays = daysBetween(HIST_START, HIST_END);
  const shuffledDays = shuffle(allDays);
  const typhoonDays = new Set(shuffledDays.slice(0, 3).map((d) => d.toISOString().slice(0, 10)));
  const rainDays = new Set(shuffledDays.slice(3, 7).map((d) => d.toISOString().slice(0, 10)));
  const weatherOf = (day) => {
    const key = day.toISOString().slice(0, 10);
    if (typhoonDays.has(key)) return 'typhoon';
    if (rainDays.has(key)) return 'rain';
    return 'normal';
  };
  console.log(`\n\ud83c\udf00 Simulated typhoon days: ${[...typhoonDays].join(', ')}`);
  console.log(`\ud83c\udf27\ufe0f  Simulated heavy-rain days: ${[...rainDays].join(', ')}`);

  // ── 6. QueueEntry history (fixed total, ~2/3 of TOTAL_RECORDS) ─────────────
  console.log('\n\ud83c\udfab Generating historical queue entries…');

  // Weight days by weather so typhoon/rain days still naturally get fewer
  // records even though the TOTAL count is fixed rather than per-day-random.
  const dayWeight = (day) => {
    const w = weatherOf(day);
    return w === 'typhoon' ? 0.1 : w === 'rain' ? 0.5 : 1.0;
  };
  const pickWeightedDay = (days) => {
    const total = days.reduce((sum, d) => sum + dayWeight(d), 0);
    let r = Math.random() * total;
    for (const d of days) {
      r -= dayWeight(d);
      if (r <= 0) return d;
    }
    return days[days.length - 1];
  };

  const TOTAL_QUEUE_ENTRIES = Math.round(NAMES.length * (2 / 3)); // ~254 of 381
  const TOTAL_APPOINTMENTS = NAMES.length - TOTAL_QUEUE_ENTRIES;   // ~127 of 381

  const queueDocs = [];
  const queueClinics = clinics.filter((c) => (c.services || []).some((s) => s.isAvailable !== false));
  const dailyCounters = new Map(); // `${clinicId}_${dayKey}` -> counter, for sequential queue numbers

  for (let i = 0; i < TOTAL_QUEUE_ENTRIES; i++) {
    const clinic = choice(queueClinics);
    const services = (clinic.services || []).filter((s) => s.isAvailable !== false);
    const day = pickWeightedDay(allDays);
    const weather = weatherOf(day);

    const counterKey = `${clinic._id}_${day.toISOString().slice(0, 10)}`;
    const counter = (dailyCounters.get(counterKey) || 0) + 1;
    dailyCounters.set(counterKey, counter);

    const patient = choice(patientPool);
    const service = choice(services);
    const perPerson = service.durationMinutes || clinic.baseWaitTimePerPerson || 10;
    const joinedAt = randomTimeOnDay(day, 7, weather === 'typhoon' ? 15 : 17);
    const isPriorityPatient = ['Senior Citizen', 'PWD', 'Pregnant', 'Priority'].includes(patient.patientType);

    const statusWeights = weather === 'normal'
      ? { completed: 78, no_show: 8, cancelled: 8, skipped: 6 }
      : { completed: 55, no_show: 20, cancelled: 18, skipped: 7 };
    const status = weightedChoice(statusWeights);

    const doc = {
      _id: new ObjectId(), clinic: clinic._id, patient: patient._id,
      patientName: patient.fullName, patientPhone: patient.phone, patientType: patient.patientType,
      queueNumber: `Q${pad3(counter)}`, serviceName: service.name, serviceId: service._id,
      queueType: isPriorityPatient ? 'Priority' : 'Regular', priority: isPriorityPatient, notes: '',
      status, joinedRemotely: Math.random() < 0.15, gracePeriodExpiresAt: null,
      joinedAt, calledAt: null, servedAt: null, completedAt: null, cancelledAt: null,
      estimatedWaitMinutes: perPerson * randInt(1, 6), positionAtJoin: randInt(1, 20),
      waitTimeInMinutes: 0, serviceTimeInMinutes: 0, turnaroundTimeInMinutes: 0,
      createdAt: joinedAt, updatedAt: joinedAt, __v: 0,
    };

    if (status === 'completed') {
      const waitMins = randInt(5, 45);
      const serviceMins = Math.max(3, perPerson + randInt(-5, 10));
      doc.calledAt = addMinutes(joinedAt, Math.max(1, waitMins - randInt(0, 4)));
      doc.servedAt = addMinutes(joinedAt, waitMins);
      doc.completedAt = addMinutes(doc.servedAt, serviceMins);
      doc.waitTimeInMinutes = waitMins;
      doc.serviceTimeInMinutes = serviceMins;
      doc.turnaroundTimeInMinutes = waitMins + serviceMins;
      doc.updatedAt = doc.completedAt;
    } else if (status === 'no_show') {
      const waitMins = randInt(10, 40);
      doc.calledAt = addMinutes(joinedAt, waitMins);
      doc.gracePeriodExpiresAt = addMinutes(doc.calledAt, 5);
      doc.updatedAt = doc.gracePeriodExpiresAt;
    } else if (status === 'cancelled') {
      const cancelMins = randInt(1, 30);
      doc.cancelledAt = addMinutes(joinedAt, cancelMins);
      doc.updatedAt = doc.cancelledAt;
    } else if (status === 'skipped') {
      const waitMins = randInt(5, 20);
      doc.calledAt = addMinutes(joinedAt, waitMins);
      doc.updatedAt = doc.calledAt;
    }

    queueDocs.push(doc);
  }

  const queueInsertDocs = queueDocs;
  if (queueInsertDocs.length) {
    const CHUNK = 2000;
    for (let i = 0; i < queueInsertDocs.length; i += CHUNK) {
      await db.collection('queueentries').insertMany(queueInsertDocs.slice(i, i + CHUNK));
    }
  }
  console.log(`  \u2713 ${queueInsertDocs.length} queue entries inserted`);

  // ── 7. Appointment history (fixed total, ~1/3 of TOTAL_RECORDS) ────────────
  console.log('\n\ud83d\udcc5 Generating historical appointments…');
  const TIME_SLOTS = ['08:00 AM','08:30 AM','09:00 AM','09:30 AM','10:00 AM','10:30 AM',
                       '11:00 AM','11:30 AM','01:00 PM','01:30 PM','02:00 PM','02:30 PM',
                       '03:00 PM','03:30 PM','04:00 PM'];
  const slotEnd = (slot) => {
    const idx = TIME_SLOTS.indexOf(slot);
    return TIME_SLOTS[Math.min(idx + 1, TIME_SLOTS.length - 1)];
  };

  const apptDocs = [];
  const apptClinics = clinics.filter((c) => c.acceptsAppointment !== false && (c.services || []).some((s) => s.isAvailable !== false));

  for (let i = 0; i < TOTAL_APPOINTMENTS; i++) {
    const clinic = choice(apptClinics);
    const services = (clinic.services || []).filter((s) => s.isAvailable !== false);
    const day = pickWeightedDay(allDays);
    const weather = weatherOf(day);

    const patient = choice(patientPool);
    const service = choice(services);
    const timeSlot = choice(TIME_SLOTS);
    // Booked some time before the visit, but never before the historical
    // window starts — keeps every record's dates inside Aug 27–Sep 11, 2026.
    const rawCreatedAt = addMinutes(day, -randInt(60, 60 * 24 * 5));
    const createdAt = rawCreatedAt < HIST_START ? new Date(HIST_START) : rawCreatedAt;

    const statusWeights = weather === 'normal'
      ? { completed: 60, no_show: 8, cancelled: 12, rescheduled: 5, late: 10, confirmed: 5 }
      : { completed: 30, no_show: 15, cancelled: 30, rescheduled: 15, late: 5, confirmed: 5 };
    const status = weightedChoice(statusWeights);

    const doc = {
      _id: new ObjectId(), clinic: clinic._id, patient: patient._id, staff: null,
      serviceName: service.name, serviceId: service._id, appointmentDate: day,
      timeSlot, endTime: slotEnd(timeSlot), patientName: patient.fullName,
      patientPhone: patient.phone, patientType: patient.patientType, status,
      reason: '', notes: weather !== 'normal' ? 'Weather-affected schedule' : '',
      previousDate: null, previousTimeSlot: null, reminderSent: true, queueEntry: null,
      confirmedAt: null, arrivedAt: null, completedAt: null, cancelledAt: null,
      cancelledBy: null, cancellationReason: '', createdAt, updatedAt: createdAt, __v: 0,
    };

    if (status === 'completed' || status === 'late') {
      doc.confirmedAt = addMinutes(createdAt, randInt(10, 120));
      doc.arrivedAt = addMinutes(day, randInt(-10, status === 'late' ? 40 : 10));
      doc.completedAt = addMinutes(doc.arrivedAt, service.durationMinutes || 30);
      doc.updatedAt = doc.completedAt;
    } else if (status === 'no_show') {
      doc.confirmedAt = addMinutes(createdAt, randInt(10, 120));
      doc.updatedAt = doc.confirmedAt;
    } else if (status === 'cancelled') {
      const rawCancelledAt = addMinutes(createdAt, randInt(10, 60 * 24));
      doc.cancelledAt = rawCancelledAt > HIST_END ? new Date(HIST_END) : rawCancelledAt;
      doc.cancelledBy = choice(['patient', 'admin']);
      doc.cancellationReason = weather !== 'normal' ? 'Typhoon / bad weather' : choice(['Schedule conflict', 'Found another provider', 'No longer needed']);
      doc.updatedAt = doc.cancelledAt;
    } else if (status === 'rescheduled') {
      doc.previousDate = day;
      doc.previousTimeSlot = timeSlot;
      // Reschedule forward a bit, but never past the end of the window.
      const rawNewDate = addMinutes(day, 60 * 24 * randInt(1, 3));
      doc.appointmentDate = rawNewDate > HIST_END ? new Date(HIST_END) : rawNewDate;
      doc.updatedAt = doc.createdAt;
    } else if (status === 'confirmed') {
      doc.confirmedAt = addMinutes(createdAt, randInt(10, 120));
      doc.updatedAt = doc.confirmedAt;
    }

    apptDocs.push(doc);
  }

  const apptInsertDocs = apptDocs;
  if (apptInsertDocs.length) {
    const CHUNK = 2000;
    for (let i = 0; i < apptInsertDocs.length; i += CHUNK) {
      await db.collection('appointments').insertMany(apptInsertDocs.slice(i, i + CHUNK));
    }
  }
  console.log(`  \u2713 ${apptInsertDocs.length} appointments inserted`);

  // ── 8. Chatbot conversations (narrow window, escalates to System Admin) ────
  console.log('\n\ud83d\udcac Generating chatbot conversations (narrow window, see TTL note)…');
  const chatDays = daysBetween(CHAT_START, CHAT_END);
  const chatLogDocs = [];
  const chatSessionDocs = [];
  const ESCALATION_MESSAGES = [
    'My appointment got cancelled because of the typhoon, can someone rebook me manually?',
    'I was marked no-show but I was actually there, can staff check this?',
    'The app is not showing my queue number, can I talk to someone?',
    'I need to reschedule but the app keeps giving an error.',
    'Is the branch closed today because of the storm? I don\'t want to travel for nothing.',
  ];

  // Pick a subset of patients who "chatted" during this window.
  const chattingPatients = shuffle(patientPool).slice(0, Math.min(140, patientPool.length));

  for (const patient of chattingPatients) {
    const clinic = choice(clinics);
    const day = choice(chatDays);
    const turnCount = randInt(1, 3);
    let lastActivityAt = null;
    let mode = 'bot';
    let assignedStaff = null;
    let activeChatLogId = null;

    for (let t = 0; t < turnCount; t++) {
      const turn = choice(CHAT_TURNS);
      const at = randomTimeOnDay(day, 8, 20);
      const patientLogId = new ObjectId();

      chatLogDocs.push({
        _id: patientLogId, patient: patient._id, senderId: String(patient._id),
        message: turn.message, reply: turn.reply, response: turn.reply,
        intent: turn.intent, confidence: turn.source === 'faq' ? 0.95 : randInt(60, 90) / 100,
        isFallback: false, source: turn.source, isEscalated: false, escalatedAt: null,
        escalationNote: '', escalatedToStaff: null, resolvedByStaff: false, resolvedAt: null,
        resolvedNote: '', clinicId: clinic._id, readByStaff: true,
        createdAt: at, updatedAt: at, __v: 0,
      });
      lastActivityAt = at;
    }

    // ~1 in 4 conversations escalates to System Admin (no staff accounts
    // exist in this seed, so System Admin is the only one who can pick
    // these up). Most are left UNRESOLVED on purpose so there's something
    // to actually resolve from the admin side.
    const willEscalate = Math.random() < 0.25;
    if (willEscalate) {
      const escMsg = choice(ESCALATION_MESSAGES);
      const escAt = addMinutes(lastActivityAt, randInt(1, 10));
      const escLogId = new ObjectId();
      const isResolved = Math.random() < 0.35; // most stay open for you to resolve
      const resolvedAt = isResolved ? addMinutes(escAt, randInt(10, 180)) : null;

      chatLogDocs.push({
        _id: escLogId, patient: patient._id, senderId: String(patient._id),
        message: escMsg, reply: '', response: '', intent: null, confidence: 0,
        isFallback: true, source: 'faq', isEscalated: true, escalatedAt: escAt,
        escalationNote: 'Auto-escalated: outside bot scope', escalatedToStaff: systemAdmin._id,
        resolvedByStaff: isResolved, resolvedAt, resolvedNote: isResolved ? 'Resolved by System Admin' : '',
        clinicId: clinic._id, readByStaff: isResolved,
        createdAt: escAt, updatedAt: resolvedAt || escAt, __v: 0,
      });

      if (isResolved) {
        const staffReplyAt = resolvedAt;
        chatLogDocs.push({
          _id: new ObjectId(), patient: patient._id, senderId: String(patient._id),
          message: '', reply: 'Thanks for your patience — this has been sorted out on our end, please check the app.', response: 'Thanks for your patience — this has been sorted out on our end, please check the app.',
          intent: null, confidence: 0, isFallback: false, source: 'staff',
          isEscalated: false, escalatedAt: null, escalationNote: '', escalatedToStaff: systemAdmin._id,
          resolvedByStaff: true, resolvedAt: staffReplyAt, resolvedNote: '',
          clinicId: clinic._id, readByStaff: false,
          createdAt: staffReplyAt, updatedAt: staffReplyAt, __v: 0,
        });
      }

      mode = isResolved ? 'bot' : 'staff';
      assignedStaff = isResolved ? null : systemAdmin._id;
      activeChatLogId = escLogId;
      lastActivityAt = resolvedAt || escAt;
    }

    chatSessionDocs.push({
      _id: new ObjectId(), patient: patient._id, clinicId: clinic._id, mode,
      assignedStaff, activeChatLogId, lastActivityAt,
      createdAt: lastActivityAt, updatedAt: lastActivityAt, __v: 0,
    });
  }

  if (chatLogDocs.length) await db.collection('chatlogs').insertMany(chatLogDocs);
  if (chatSessionDocs.length) await db.collection('chatsessions').insertMany(chatSessionDocs);
  console.log(`  \u2713 ${chatLogDocs.length} chat log entries, ${chatSessionDocs.length} chat sessions inserted`);
  console.log(`  \u26a0\ufe0f  Remember: MongoDB's 7-day TTL on ChatLog will auto-delete these once they age past ${CHAT_START.toISOString().slice(0,10)} + 7 days — that's expected, not a bug.`);

  // ── 9. Notifications ────────────────────────────────────────────────────────
  console.log('\n\ud83d\udd14 Generating notifications…');
  const notificationDocs = [];

  // Welcome notification per new patient
  for (const p of patientPool) {
    const user = userDocs.find((u) => String(u._id) === String(p._id));
    notificationDocs.push({
      _id: new ObjectId(), user: p._id, title: 'Welcome to HealthQueue+',
      message: 'Your account has been created. Find a nearby clinic and join the queue or book an appointment anytime.',
      type: 'system', channel: 'in_app', refType: null, refId: null,
      isRead: Math.random() < 0.6, smsStatus: 'sent',
      createdAt: user.createdAt, updatedAt: user.createdAt, __v: 0,
    });
  }

  // Queue-lifecycle notifications
  for (const q of queueDocs) {
    if (q.status === 'completed') {
      notificationDocs.push({
        _id: new ObjectId(), user: q.patient, title: 'Visit completed',
        message: `Your ${q.serviceName} visit is complete. Thank you for choosing us.`,
        type: 'queue', channel: 'in_app', refType: 'QueueEntry', refId: q._id,
        isRead: Math.random() < 0.7, smsStatus: 'sent',
        createdAt: q.completedAt, updatedAt: q.completedAt, __v: 0,
      });
    } else if (q.status === 'no_show') {
      notificationDocs.push({
        _id: new ObjectId(), user: q.patient, title: 'Marked as no-show',
        message: `You were marked no-show for your ${q.serviceName} queue entry.`,
        type: 'queue', channel: 'both', refType: 'QueueEntry', refId: q._id,
        isRead: Math.random() < 0.5, smsStatus: 'sent',
        createdAt: q.calledAt, updatedAt: q.calledAt, __v: 0,
      });
    } else if (q.status === 'cancelled') {
      notificationDocs.push({
        _id: new ObjectId(), user: q.patient, title: 'Queue entry cancelled',
        message: `Your ${q.serviceName} queue entry was cancelled.`,
        type: 'queue', channel: 'in_app', refType: 'QueueEntry', refId: q._id,
        isRead: Math.random() < 0.5, smsStatus: 'sent',
        createdAt: q.cancelledAt, updatedAt: q.cancelledAt, __v: 0,
      });
    }
  }

  // Appointment-lifecycle notifications
  for (const a of apptDocs) {
    if (a.status === 'confirmed' || a.status === 'completed' || a.status === 'late') {
      notificationDocs.push({
        _id: new ObjectId(), user: a.patient, title: 'Appointment reminder',
        message: `Reminder: your ${a.serviceName} appointment is on ${a.appointmentDate.toISOString().slice(0,10)} at ${a.timeSlot}.`,
        type: 'reminder', channel: 'both', refType: 'Appointment', refId: a._id,
        isRead: Math.random() < 0.6, smsStatus: 'sent',
        createdAt: a.confirmedAt || a.createdAt, updatedAt: a.confirmedAt || a.createdAt, __v: 0,
      });
    }
    if (a.status === 'cancelled') {
      notificationDocs.push({
        _id: new ObjectId(), user: a.patient, title: 'Appointment cancelled',
        message: `Your ${a.serviceName} appointment on ${a.appointmentDate.toISOString().slice(0,10)} was cancelled. Reason: ${a.cancellationReason}.`,
        type: 'appointment', channel: 'both', refType: 'Appointment', refId: a._id,
        isRead: Math.random() < 0.5, smsStatus: 'sent',
        createdAt: a.cancelledAt, updatedAt: a.cancelledAt, __v: 0,
      });
    }
    if (a.status === 'rescheduled') {
      notificationDocs.push({
        _id: new ObjectId(), user: a.patient, title: 'Appointment rescheduled',
        message: `Your ${a.serviceName} appointment was moved to ${a.appointmentDate.toISOString().slice(0,10)}.`,
        type: 'appointment', channel: 'in_app', refType: 'Appointment', refId: a._id,
        isRead: Math.random() < 0.5, smsStatus: 'sent',
        createdAt: a.updatedAt, updatedAt: a.updatedAt, __v: 0,
      });
    }
  }

  if (notificationDocs.length) {
    const CHUNK = 2000;
    for (let i = 0; i < notificationDocs.length; i += CHUNK) {
      await db.collection('notifications').insertMany(notificationDocs.slice(i, i + CHUNK));
    }
  }
  console.log(`  \u2713 ${notificationDocs.length} notifications inserted`);

  // ── 10. Audit logs ─────────────────────────────────────────────────────────
  console.log('\n\ud83d\udcdc Generating audit logs…');
  const auditDocs = [];

  // Daily System Admin login/logout (skip mostly on typhoon days). No
  // healthcare-staff or facility_admin accounts exist in this seed, so
  // System Admin is the sole actor behind every logged action.
  for (const day of allDays) {
    const weather = weatherOf(day);
    const showedUp = weather === 'typhoon' ? Math.random() < 0.2 : Math.random() < 0.9;
    if (!showedUp) continue;
    const loginAt = randomTimeOnDay(day, 7, 9);
    const logoutAt = randomTimeOnDay(day, 16, 18);
    auditDocs.push({
      _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
      action: 'login', targetType: 'User', targetId: systemAdmin._id, targetLabel: systemAdmin.fullName,
      clinicId: null, details: {}, createdAt: loginAt, updatedAt: loginAt, __v: 0,
    });
    auditDocs.push({
      _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
      action: 'logout', targetType: 'User', targetId: systemAdmin._id, targetLabel: systemAdmin.fullName,
      clinicId: null, details: {}, createdAt: logoutAt, updatedAt: logoutAt, __v: 0,
    });
  }

  // Queue entry actions
  for (const q of queueDocs) {
    if (q.calledAt) {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'call', targetType: 'QueueEntry', targetId: q._id, targetLabel: q.patientName,
        clinicId: q.clinic, details: { queueNumber: q.queueNumber },
        createdAt: q.calledAt, updatedAt: q.calledAt, __v: 0,
      });
    }
    if (q.status === 'completed') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'complete', targetType: 'QueueEntry', targetId: q._id, targetLabel: q.patientName,
        clinicId: q.clinic, details: { serviceName: q.serviceName },
        createdAt: q.completedAt, updatedAt: q.completedAt, __v: 0,
      });
    } else if (q.status === 'no_show') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'no_show', targetType: 'QueueEntry', targetId: q._id, targetLabel: q.patientName,
        clinicId: q.clinic, details: {}, createdAt: q.updatedAt, updatedAt: q.updatedAt, __v: 0,
      });
    } else if (q.status === 'skipped') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'skip', targetType: 'QueueEntry', targetId: q._id, targetLabel: q.patientName,
        clinicId: q.clinic, details: {}, createdAt: q.updatedAt, updatedAt: q.updatedAt, __v: 0,
      });
    } else if (q.status === 'cancelled') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'update', targetType: 'QueueEntry', targetId: q._id, targetLabel: q.patientName,
        clinicId: q.clinic, details: { change: 'status -> cancelled' },
        createdAt: q.cancelledAt, updatedAt: q.cancelledAt, __v: 0,
      });
    }
  }

  // Appointment actions
  for (const a of apptDocs) {
    if (a.status === 'completed' || a.status === 'late') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'complete', targetType: 'Appointment', targetId: a._id, targetLabel: a.patientName,
        clinicId: a.clinic, details: { serviceName: a.serviceName },
        createdAt: a.completedAt, updatedAt: a.completedAt, __v: 0,
      });
    } else if (a.status === 'no_show') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'no_show', targetType: 'Appointment', targetId: a._id, targetLabel: a.patientName,
        clinicId: a.clinic, details: {}, createdAt: a.updatedAt, updatedAt: a.updatedAt, __v: 0,
      });
    } else if (a.status === 'cancelled' || a.status === 'rescheduled') {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'update', targetType: 'Appointment', targetId: a._id, targetLabel: a.patientName,
        clinicId: a.clinic, details: { change: `status -> ${a.status}` },
        createdAt: a.updatedAt, updatedAt: a.updatedAt, __v: 0,
      });
    }
  }

  // Chat escalation resolutions (only the ones already resolved in seed data)
  for (const log of chatLogDocs) {
    if (log.isEscalated && log.resolvedByStaff) {
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'resolve', targetType: 'ChatLog', targetId: log._id, targetLabel: 'Chat escalation',
        clinicId: log.clinicId, details: {},
        createdAt: log.resolvedAt, updatedAt: log.resolvedAt, __v: 0,
      });
    }
  }

  // ── 10b. Admin-side account/clinic lifecycle events ────────────────────────
  // Rounds out the audit trail with the events that don't fall naturally out
  // of queue/appointment/chat activity: account creation, deactivation,
  // reactivation, a clinic settings update, and a record deletion.
  console.log('\n\ud83d\udee1\ufe0f  Generating admin-side lifecycle events…');

  // 'create' — clinics (attributed to System Admin, timestamped at/just before HIST_START)
  for (const clinic of clinics) {
    const at = addMinutes(HIST_START, -randInt(60, 60 * 24 * 3));
    auditDocs.push({
      _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
      action: 'create', targetType: 'Clinic', targetId: clinic._id, targetLabel: clinic.name,
      clinicId: clinic._id, details: { note: 'Initial clinic setup' },
      createdAt: at, updatedAt: at, __v: 0,
    });
  }

  // 'update' — System Admin tweaks one clinic's settings mid-window (also applied for real)
  const updatedClinic = choice(clinics);
  const clinicUpdateAt = randomTimeOnDay(choice(allDays), 9, 16);
  const newCapacity = (updatedClinic.maxQueueCapacity || 80) + 20;
  await Clinic.findOneAndUpdate({ _id: updatedClinic._id }, { $set: { maxQueueCapacity: newCapacity } });
  auditDocs.push({
    _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
    action: 'update', targetType: 'Clinic', targetId: updatedClinic._id, targetLabel: updatedClinic.name,
    clinicId: updatedClinic._id, details: { change: `maxQueueCapacity -> ${newCapacity}` },
    createdAt: clinicUpdateAt, updatedAt: clinicUpdateAt, __v: 0,
  });

  // 'deactivate' / 'reactivate' — a handful of patient accounts (System Admin is
  // the only actor in this seed, since no staff/facility_admin accounts exist)
  const patientsToToggle = shuffle(patientPool).slice(0, 6);
  for (const p of patientsToToggle) {
    const deactivatedAt = randomTimeOnDay(choice(allDays), 9, 16);
    auditDocs.push({
      _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
      action: 'deactivate', targetType: 'User', targetId: p._id, targetLabel: p.fullName,
      clinicId: null, details: { reason: choice(['Duplicate account', 'Requested by patient', 'Inactivity']) },
      createdAt: deactivatedAt, updatedAt: deactivatedAt, __v: 0,
    });

    const willReactivate = Math.random() < 0.5;
    if (willReactivate) {
      const reactivatedAt = addMinutes(deactivatedAt, randInt(60, 60 * 24 * 3));
      auditDocs.push({
        _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
        action: 'reactivate', targetType: 'User', targetId: p._id, targetLabel: p.fullName,
        clinicId: null, details: {},
        createdAt: reactivatedAt, updatedAt: reactivatedAt, __v: 0,
      });
      await db.collection('users').updateOne({ _id: p._id }, { $set: { isActive: true, updatedAt: reactivatedAt } });
      await db.collection('patients').updateOne({ user: p._id }, { $set: { isActive: true, updatedAt: reactivatedAt } });
    } else {
      await db.collection('users').updateOne({ _id: p._id }, { $set: { isActive: false, updatedAt: deactivatedAt } });
      await db.collection('patients').updateOne({ user: p._id }, { $set: { isActive: false, updatedAt: deactivatedAt } });
    }
  }

  // 'delete' — a throwaway duplicate patient record, created then deleted by an admin
  const dupeId = new ObjectId();
  const dupeCreatedAt = randomTimeOnDay(choice(allDays), 9, 16);
  await db.collection('users').insertOne({
    _id: dupeId, fullName: 'Duplicate Test Entry', email: toEmail('Duplicate Test Entry'), phone: toPhone(),
    fcmToken: null, password: PATIENT_PASSWORD_HASH, role: 'patient', clinicId: null,
    otp: null, otpExpires: null, isVerified: true, isActive: true, gender: 'Other', specialization: '',
    createdAt: dupeCreatedAt, updatedAt: dupeCreatedAt, __v: 0,
  });
  auditDocs.push({
    _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
    action: 'create', targetType: 'User', targetId: dupeId, targetLabel: 'Duplicate Test Entry',
    clinicId: null, details: {}, createdAt: dupeCreatedAt, updatedAt: dupeCreatedAt, __v: 0,
  });
  const dupeDeletedAt = addMinutes(dupeCreatedAt, randInt(5, 120));
  await db.collection('users').deleteOne({ _id: dupeId });
  auditDocs.push({
    _id: new ObjectId(), actor: systemAdmin._id, actorName: systemAdmin.fullName, actorRole: 'super_admin',
    action: 'delete', targetType: 'User', targetId: dupeId, targetLabel: 'Duplicate Test Entry',
    clinicId: null, details: { reason: 'Duplicate registration, merged into existing account' },
    createdAt: dupeDeletedAt, updatedAt: dupeDeletedAt, __v: 0,
  });

  console.log(`  \u2713 Admin lifecycle events ready: ${clinics.length} clinic creates, 1 clinic update, ${patientsToToggle.length} patient deactivate/reactivate cycles, 1 create+delete`);

  if (auditDocs.length) {
    const CHUNK = 2000;
    for (let i = 0; i < auditDocs.length; i += CHUNK) {
      await db.collection('auditlogs').insertMany(auditDocs.slice(i, i + CHUNK));
    }
  }
  console.log(`  \u2713 ${auditDocs.length} audit log entries inserted`);

  console.log('\n' + '─'.repeat(55));
  console.log('\ud83c\udf89 Historical data seed complete!\n');
  console.log(`  Clinics ready:         ${clinics.length}`);
  console.log(`  System Admin:          ${SYSTEM_ADMIN.email}`);
  console.log(`  Patients created:     ${NAMES.length}`);
  console.log(`  Queue entries:        ${queueInsertDocs.length}`);
  console.log(`  Appointments:         ${apptInsertDocs.length}`);
  console.log(`  Chat logs:            ${chatLogDocs.length} (window: ${CHAT_START.toISOString().slice(0,10)}..${CHAT_END.toISOString().slice(0,10)})`);
  console.log(`  Notifications:        ${notificationDocs.length}`);
  console.log(`  Audit logs:           ${auditDocs.length} (includes account/clinic lifecycle events)`);
  console.log(`  Full history range:   ${HIST_START.toISOString().slice(0,10)} → ${HIST_END.toISOString().slice(0,10)}`);
  console.log(`  Typhoon days:         ${[...typhoonDays].join(', ')}`);
  console.log(`  Heavy-rain days:      ${[...rainDays].join(', ')}`);
  console.log('─'.repeat(55));

  await mongoose.disconnect();
}

main().catch((err) => {
  console.error('\u274c Seed failed:', err);
  process.exit(1);
});