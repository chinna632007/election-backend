// Load .env relative to THIS file (src/config/), so startup works regardless
// of the current working directory (project root, backend dir, or anywhere).
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

const mongoUri = process.env.MONGODB_URI?.trim();
const missing = [
  ...(!mongoUri ? ['MONGODB_URI'] : []),
  ...(!process.env.SESSION_SECRET ? ['SESSION_SECRET'] : []),
];
if (missing.length > 0) {
  throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
}
if (!/^mongodb(?:\+srv)?:\/\//i.test(mongoUri)) {
  throw new Error('Invalid MongoDB configuration: MONGODB_URI must use mongodb:// or mongodb+srv://');
}

module.exports = {
  mongoUri,
  mongoDatabase: process.env.MONGODB_DATABASE || undefined,
  sessionSecret: process.env.SESSION_SECRET,
  port: Number(process.env.PORT) || 3000,
  // Dates/times / letter metadata (team decision: .env wins for training orders).
  // Edit + restart to change. See TRAINING-ORDERS-ANALYSIS.md.
  training: {
    date: process.env.TRAINING_DATE || '',
    timeFrom: process.env.TRAINING_TIME_FROM || '',
    timeTo: process.env.TRAINING_TIME_TO || '',
    venue: process.env.TRAINING_VENUE || '',
    mandal: process.env.TRAINING_MANDAL || '',
  },
  orders: {
    pollingDateTime: process.env.POLLING_DATE_TIME || '',
    distributionCenter: process.env.DISTRIBUTION_CENTER || '',
    distributionReportTime: process.env.DISTRIBUTION_REPORT_TIME || '',
  },
  districtName: process.env.DISTRICT_NAME || 'Kakinada',
  orderDate: process.env.ORDER_DATE || '',
  orderPlace: process.env.ORDER_PLACE || '',
  electionYear: process.env.ELECTION_YEAR || '',
};
