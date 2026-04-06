/**
 * FileSure Express API Server
 * Endpoints: GET /companies, GET /companies/summary, filterable by status & state
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
require('dotenv').config();

const app = express();
const { MongoClient } = require('mongodb');

// Middleware
app.use(cors());
app.use(express.json());

// Configuration
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/';
const DB_NAME = process.env.DB_NAME || 'filesure';
const COLLECTION_NAME = process.env.COLLECTION_NAME || 'companies';
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ALLOWED_COMPANY_QUERY_PARAMS = new Set(['page', 'limit', 'status', 'state']);

// MongoDB client (shared connection)
let mongoClient;
let db;
let collection;
let fallbackCompanies = [];

app.use(express.static(path.join(__dirname, 'public')));

function loadFallbackData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      fallbackCompanies = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
      console.log(`✓ Loaded ${fallbackCompanies.length} records from data.json fallback`);
    } else {
      fallbackCompanies = [];
      console.warn('⚠ data.json not found; fallback dataset is empty');
    }
  } catch (error) {
    fallbackCompanies = [];
    console.error('✗ Failed to load fallback data:', error.message);
  }
}

function queryFallbackCompanies({ page, limit, status, state }) {
  let filtered = fallbackCompanies;

  if (status) {
    const normalized = status.toLowerCase();
    const variants = new Set([
      normalized,
      normalized.replace(/ /g, '_'),
      normalized.replace(/_/g, ' '),
    ]);
    filtered = filtered.filter((company) => variants.has((company.status || '').toLowerCase()));
  }

  if (state) {
    filtered = filtered.filter((company) => company.state === state);
  }

  const total = filtered.length;
  const startIndex = (page - 1) * limit;
  const companies = filtered.slice(startIndex, startIndex + limit).map((company) => ({
    cin: company.cin,
    company_name: company.company_name,
    status: company.status,
    state: company.state,
    email: company.email,
    incorporation_date: company.incorporation_date,
    email_valid: company.email_valid,
  }));

  return {
    total,
    companies,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  };
}

function summarizeFallbackCompanies() {
  return fallbackCompanies.reduce((accumulator, company) => {
    const status = company.status || 'unknown';
    accumulator[status] = (accumulator[status] || 0) + 1;
    return accumulator;
  }, {});
}

function statsFallbackCompanies() {
  const byStatus = Object.entries(summarizeFallbackCompanies()).map(([status, count]) => ({
    _id: status,
    count,
  }));
  const byStateMap = fallbackCompanies.reduce((accumulator, company) => {
    const state = company.state || 'unknown';
    accumulator[state] = (accumulator[state] || 0) + 1;
    return accumulator;
  }, {});
  const emailQualityMap = fallbackCompanies.reduce((accumulator, company) => {
    const key = company.email_valid ? 'true' : 'false';
    accumulator[key] = (accumulator[key] || 0) + 1;
    return accumulator;
  }, {});

  return {
    byStatus: byStatus.sort((left, right) => right.count - left.count),
    byState: Object.entries(byStateMap)
      .map(([state, count]) => ({ _id: state, count }))
      .sort((left, right) => right.count - left.count),
    emailQuality: Object.entries(emailQualityMap).map(([flag, count]) => ({
      _id: flag === 'true',
      count,
    })),
    total: [{ count: fallbackCompanies.length }],
  };
}

function validateCompaniesQuery(query) {
  const unknownParams = Object.keys(query).filter((key) => !ALLOWED_COMPANY_QUERY_PARAMS.has(key));
  if (unknownParams.length > 0) {
    return {
      ok: false,
      status: 400,
      body: {
        error: `Unsupported query parameter(s): ${unknownParams.join(', ')}`,
        code: 400,
      },
    };
  }

  const parsePositiveInteger = (rawValue, fieldName, max) => {
    if (rawValue === undefined) {
      return { ok: true, value: undefined };
    }

    if (!/^\d+$/.test(String(rawValue))) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `${fieldName} must be a positive integer`,
          code: 400,
        },
      };
    }

    const parsedValue = Number(rawValue);
    if (parsedValue < 1 || (max !== undefined && parsedValue > max)) {
      return {
        ok: false,
        status: 400,
        body: {
          error: max === undefined
            ? `${fieldName} must be a positive integer`
            : `${fieldName} must be between 1 and ${max}`,
          code: 400,
        },
      };
    }

    return { ok: true, value: parsedValue };
  };

  const pageResult = parsePositiveInteger(query.page, 'page');
  if (!pageResult.ok) {
    return pageResult;
  }

  const limitResult = parsePositiveInteger(query.limit, 'limit', 100);
  if (!limitResult.ok) {
    return limitResult;
  }

  return {
    ok: true,
    value: {
      page: pageResult.value ?? 1,
      limit: limitResult.value ?? 10,
      status: typeof query.status === 'string' ? query.status : undefined,
      state: typeof query.state === 'string' ? query.state : undefined,
    },
  };
}

/**
 * Connect to MongoDB
 */
async function connectDatabase() {
  try {
    mongoClient = new MongoClient(MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    db = mongoClient.db(DB_NAME);
    collection = db.collection(COLLECTION_NAME);
    console.log(`✓ Connected to MongoDB: ${DB_NAME}.${COLLECTION_NAME}`);
    return true;
  } catch (error) {
    console.error('✗ MongoDB connection failed:', error.message);
    loadFallbackData();
    return false;
  }
}

/**
 * Error handler middleware
 */
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal Server Error',
    code: err.status || 500,
  });
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    dataSource: collection ? 'mongodb' : 'data.json',
    fallbackRecords: fallbackCompanies.length,
  });
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/**
 * GET /companies
 * Returns all companies with pagination
 * Query params: page=1, limit=10, status=Active, state=Maharashtra
 */
app.get('/companies', async (req, res, next) => {
  try {
    const validation = validateCompaniesQuery(req.query);
    if (!validation.ok) {
      return res.status(validation.status).json(validation.body);
    }

    const { page, limit, status, state } = validation.value;
    const skip = (page - 1) * limit;

    if (!collection) {
      const fallbackResult = queryFallbackCompanies({
        page,
        limit,
        status,
        state,
      });

      return res.json({
        success: true,
        dataSource: 'data.json',
        pagination: {
          page,
          limit,
          total: fallbackResult.total,
          totalPages: fallbackResult.totalPages,
        },
        companies: fallbackResult.companies,
      });
    }

    // Build filter object
    const filter = {};

    // Filter by status if provided
    if (status) {
      const statusValue = status.toLowerCase();
      // Normalize status for matching
      filter.status = {
        $in: [
          statusValue,
          statusValue.replace(/ /g, '_'),
          statusValue.replace(/_/g, ' '),
        ],
      };
    }

    // Filter by state if provided
    if (state) {
      filter.state = state;
    }

    // Execute queries
    const [total, companies] = await Promise.all([
      collection.countDocuments(filter),
      collection
        .find(filter)
        .project({
          cin: 1,
          company_name: 1,
          status: 1,
          state: 1,
          email: 1,
          incorporation_date: 1,
          email_valid: 1,
        })
        .skip(skip)
        .limit(limit)
        .toArray(),
    ]);

    const totalPages = Math.ceil(total / limit);

    res.json({
      success: true,
      dataSource: 'mongodb',
      pagination: {
        page,
        limit,
        total,
        totalPages,
      },
      companies,
    });
  } catch (error) {
    console.error('GET /companies error:', error);
    res.status(500).json({
      error: 'Failed to fetch companies',
      code: 500,
      details: error.message,
    });
  }
});

/**
 * GET /companies/summary
 * Returns aggregated count by status
 */
app.get('/companies/summary', async (req, res) => {
  try {
    if (!collection) {
      const result = summarizeFallbackCompanies();
      return res.json({
        success: true,
        dataSource: 'data.json',
        summary: result,
        total: Object.values(result).reduce((sum, value) => sum + value, 0),
      });
    }

    // Aggregation pipeline
    const summary = await collection
      .aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
          },
        },
        {
          $sort: { count: -1 },
        },
      ])
      .toArray();

    // Convert to object format
    const result = {};
    summary.forEach((item) => {
      result[item._id || 'unknown'] = item.count;
    });

    res.json({
      success: true,
      dataSource: 'mongodb',
      summary: result,
      total: Object.values(result).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error('GET /companies/summary error:', error);
    res.status(500).json({
      error: 'Failed to fetch summary',
      code: 500,
      details: error.message,
    });
  }
});

/**
 * GET /companies/stats
 * Additional endpoint for detailed statistics (for video explanation)
 */
app.get('/companies/stats', async (req, res) => {
  try {
    if (!collection) {
      return res.json({
        success: true,
        dataSource: 'data.json',
        stats: statsFallbackCompanies(),
      });
    }

    const stats = await collection
      .aggregate([
        {
          $facet: {
            byStatus: [
              { $group: { _id: '$status', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ],
            byState: [
              { $group: { _id: '$state', count: { $sum: 1 } } },
              { $sort: { count: -1 } },
            ],
            emailQuality: [
              {
                $group: {
                  _id: '$email_valid',
                  count: { $sum: 1 },
                },
              },
            ],
            total: [{ $count: 'count' }],
          },
        },
      ])
      .toArray();

    res.json({
      success: true,
      dataSource: 'mongodb',
      stats: stats[0],
    });
  } catch (error) {
    console.error('GET /companies/stats error:', error);
    res.status(500).json({
      error: 'Failed to fetch stats',
      code: 500,
    });
  }
});

/**
 * 404 handler
 */
app.use((req, res) => {
  res.status(404).json({
    error: 'Endpoint not found',
    code: 404,
    path: req.path,
  });
});

/**
 * Start server
 */
async function startServer() {
  try {
    // Connect to database first
    const connected = await connectDatabase();

    if (!connected) {
      console.warn('⚠ Starting API without database connection');
      console.warn('⚠ Database endpoints will return 503 until connection is available');
    }

    // Start listening
    app.listen(PORT, () => {
      console.log(`\n✓ FileSure API Server running on http://localhost:${PORT}`);
      console.log(`✓ Endpoints:`);
      console.log(`  GET  /health - Health check`);
      console.log(`  GET  /companies - List companies with pagination`);
      console.log(`  GET  /companies?status=Active&state=Maharashtra - Filtered companies`);
      console.log(`  GET  /companies/summary - Aggregate by status`);
      console.log(`  GET  /companies/stats - Detailed statistics\n`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  if (mongoClient) {
    await mongoClient.close();
    console.log('✓ MongoDB connection closed');
  }
  process.exit(0);
});

// Start
startServer();

module.exports = app;
