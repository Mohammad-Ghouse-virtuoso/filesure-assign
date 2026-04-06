/**
 * FileSure Frontend - API Integration & UI Logic
 */

const API_URL = window.location.origin;

// State
let currentPage = 1;
let currentLimit = 10;
let currentStatus = '';
let currentState = '';
let allStates = new Set();

// DOM Elements
const statusFilter = document.getElementById('statusFilter');
const stateFilter = document.getElementById('stateFilter');
const applyFiltersBtn = document.getElementById('applyFiltersBtn');
const resetFiltersBtn = document.getElementById('resetFiltersBtn');
const companiesBody = document.getElementById('companiesBody');
const loadingIndicator = document.getElementById('loadingIndicator');
const errorMessage = document.getElementById('errorMessage');
const pageInfo = document.getElementById('pageInfo');
const prevPageBtn = document.getElementById('prevPageBtn');
const nextPageBtn = document.getElementById('nextPageBtn');
const statsContainer = document.getElementById('statsContainer');

/**
 * Fetch and display statistics
 */
async function loadStats() {
  try {
    const response = await fetch(`${API_URL}/companies/stats`);
    if (!response.ok) throw new Error('Failed to fetch stats');

    const data = await response.json();
    const { stats } = data;

    // Build stats display
    const statCards = [];

    // Total companies
    if (stats.total && stats.total.length > 0) {
      statCards.push(
        createStatCard('Total Companies', stats.total[0].count)
      );
    }

    // By status
    if (stats.byStatus && stats.byStatus.length > 0) {
      stats.byStatus.forEach((item) => {
        statCards.push(
          createStatCard(
            formatStatusLabel(item._id),
            item.count
          )
        );
      });
    }

    // Email quality
    if (stats.emailQuality && stats.emailQuality.length > 0) {
      stats.emailQuality.forEach((item) => {
        const label = item._id ? 'Valid Emails' : 'Invalid Emails';
        statCards.push(createStatCard(label, item.count));
      });
    }

    statsContainer.innerHTML = statCards.join('');
  } catch (error) {
    console.error('Error loading stats:', error);
    statsContainer.innerHTML = `<div class="stat-card" style="color: #dc3545;">Error loading stats</div>`;
  }
}

/**
 * Create a stat card HTML
 */
function createStatCard(label, value) {
  return `
    <div class="stat-card">
      <h3>${label}</h3>
      <div class="value">${value}</div>
    </div>
  `;
}

/**
 * Format status label for display
 */
function formatStatusLabel(status) {
  if (!status) return 'Unknown';
  return status
    .replace(/_/g, ' ')
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Fetch and populate states dropdown
 */
async function loadStates() {
  try {
    const response = await fetch(`${API_URL}/companies?limit=1000`);
    if (!response.ok) throw new Error('Failed to fetch companies');

    const data = await response.json();
    const states = new Set();

    data.companies.forEach((company) => {
      if (company.state) {
        states.add(company.state);
      }
    });

    // Sort and populate dropdown
    const sortedStates = Array.from(states).sort();
    sortedStates.forEach((state) => {
      const option = document.createElement('option');
      option.value = state;
      option.textContent = state;
      stateFilter.appendChild(option);
    });

    allStates = states;
  } catch (error) {
    console.error('Error loading states:', error);
  }
}

/**
 * Fetch companies from API
 */
async function fetchCompanies() {
  showLoading(true);
  hideError();

  try {
    // Build query parameters
    const params = new URLSearchParams({
      page: currentPage,
      limit: currentLimit,
    });

    if (currentStatus) {
      params.append('status', currentStatus);
    }

    if (currentState) {
      params.append('state', currentState);
    }

    const response = await fetch(`${API_URL}/companies?${params}`);

    if (!response.ok) {
      if (response.status === 503) {
        throw new Error('Database is not connected. Please start MongoDB.');
      }
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    // Update pagination buttons
    const { pagination } = data;
    updatePagination(pagination);

    // Render table
    renderCompanies(data.companies);

    showLoading(false);
  } catch (error) {
    console.error('Error fetching companies:', error);
    showError(error.message);
    showLoading(false);
    companiesBody.innerHTML = '<tr class="no-data"><td colspan="7">Error loading companies</td></tr>';
  }
}

/**
 * Render companies table
 */
function renderCompanies(companies) {
  if (!companies || companies.length === 0) {
    companiesBody.innerHTML = '<tr class="no-data"><td colspan="7">No companies found</td></tr>';
    return;
  }

  const rows = companies
    .map(
      (company) => `
    <tr>
      <td>${company.cin || '—'}</td>
      <td>${company.company_name}</td>
      <td><span class="status-badge ${company.status}">${formatStatusLabel(company.status)}</span></td>
      <td>${company.state || '—'}</td>
      <td>${formatDate(company.incorporation_date)}</td>
      <td>${company.email || '—'}</td>
      <td>
        <span class="${company.email_valid ? 'email-valid' : 'email-invalid'}">
          ${company.email_valid ? '✓' : '✗'}
        </span>
      </td>
    </tr>
  `
    )
    .join('');

  companiesBody.innerHTML = rows;
}

/**
 * Format date for display
 */
function formatDate(isoDate) {
  if (!isoDate) return '—';
  try {
    const date = new Date(isoDate);
    return date.toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return '—';
  }
}

/**
 * Update pagination info and buttons
 */
function updatePagination(pagination) {
  const { page, totalPages } = pagination;
  pageInfo.textContent = `Page ${page} of ${totalPages}`;
  prevPageBtn.disabled = page === 1;
  nextPageBtn.disabled = page >= totalPages;
}

/**
 * Show/hide loading indicator
 */
function showLoading(show) {
  if (show) {
    loadingIndicator.classList.remove('hidden');
  } else {
    loadingIndicator.classList.add('hidden');
  }
}

/**
 * Show error message
 */
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.remove('hidden');
}

/**
 * Hide error message
 */
function hideError() {
  errorMessage.classList.add('hidden');
}

/**
 * Event Listeners
 */

// Apply filters
applyFiltersBtn.addEventListener('click', () => {
  currentStatus = statusFilter.value;
  currentState = stateFilter.value;
  currentPage = 1;
  fetchCompanies();
});

// Reset filters
resetFiltersBtn.addEventListener('click', () => {
  statusFilter.value = '';
  stateFilter.value = '';
  currentStatus = '';
  currentState = '';
  currentPage = 1;
  fetchCompanies();
});

// Pagination
prevPageBtn.addEventListener('click', () => {
  if (currentPage > 1) {
    currentPage--;
    fetchCompanies();
    window.scrollTo(0, 0);
  }
});

nextPageBtn.addEventListener('click', () => {
  currentPage++;
  fetchCompanies();
  window.scrollTo(0, 0);
});

/**
 * Initialize app
 */
async function init() {
  console.log('Initializing FileSure Dashboard...');
  await loadStats();
  await loadStates();
  await fetchCompanies();
}

// Start when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
