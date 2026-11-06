const app = require('./app');
const config = require('./config');
const { connectDatabase, getCollection } = require('./database');

async function startServer() {
  try {
    await connectDatabase();
    try {
      const col = getCollection('workflow_state');
      const target = col.collection || col;
      if (target && typeof target.deleteMany === 'function') {
        await target.deleteMany({});
      }
    } catch {
      // non-blocking
    }
    app.listen(config.port, '0.0.0.0', () => {
      console.log(`Server listening on port ${config.port}`);
    });
  } catch (error) {
    console.error(`MongoDB startup failed (${error.name || 'Error'}): ${error.message}`);
    process.exitCode = 1;
  }
}

startServer();
