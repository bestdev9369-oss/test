const axios = require("axios");

const API_KEY = "ak_a6ab09738989b730083b00a9bf9e73616df09b5ee0a61505";
const BASE_URL = "https://assessment.ksensetech.com/api";

const MAX_RETRIES = 5;
const REQUEST_DELAY = 700;

/* ---------------- UTILITY ---------------- */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ---------------- SAFE API REQUEST ---------------- */

async function apiRequest(url, params = {}, attempt = 1) {
  try {
    const response = await axios.get(url, {
      params,
      headers: { "x-api-key": API_KEY },
      timeout: 5000
    });

    return response.data;

  } catch (error) {
    const status = error.response?.status;

    if ([429, 500, 503].includes(status) && attempt <= MAX_RETRIES) {
      const delay = REQUEST_DELAY * attempt * 2;

      console.log(`Retry ${attempt} (status ${status}) waiting ${delay}ms`);

      await sleep(delay);

      return apiRequest(url, params, attempt + 1);
    }

    throw error;
  }
}

/* ---------------- FETCH ALL PATIENTS ---------------- */
/*---- Common functions ----*/
function isEmpty(value){ return value === undefined || value === null || (typeof value === 'object' && Object.keys(value).length === 0) || (typeof value === 'string' && value.trim().length === 0)};


async function fetchAllPatients() {
  let page = 1;
  let hasNext = true;
  const allPatients = [];

  while (hasNext) {

    console.log(`Fetching page ${page}`);

    const result = await apiRequest(`${BASE_URL}/patients`, {
      page,
      limit: 5
    });

    if(result.data === undefined)
      continue

    if (Array.isArray(result.data)) {
      allPatients.push(...result.data);
    }

    hasNext = result.pagination?.hasNext === true;

    page++;

    await sleep(REQUEST_DELAY);
  }

  return allPatients;
}

/* ---------------- DATA VALIDATION ---------------- */

function parseBP(bp) {
  if (!bp || typeof bp !== "string") return null;

  const parts = bp.split("/");

  if (parts.length !== 2) return null;

  const systolic = Number(parts[0]);
  const diastolic = Number(parts[1]);

  if (isNaN(systolic) || isNaN(diastolic)) return null;

  return { systolic, diastolic };
}

/* ---------------- SCORING ---------------- */

function bpScore(bp) {
  const parsed = parseBP(bp);
  if (!parsed) return { score: 0, invalid: true };

  const { systolic, diastolic } = parsed;

  if (systolic < 120 && diastolic < 80) return { score: 0 };
  if (systolic >= 120 && systolic <= 129 && diastolic < 80) return { score: 1 };
  if ((systolic >= 130 && systolic <= 139) || (diastolic >= 80 && diastolic <= 89)) return { score: 2 };
  if (systolic >= 140 || diastolic >= 90) return { score: 3 };

  return { score: 0 };
}

function tempScore(temp) {
  if (typeof temp !== "number") return { score: 0, invalid: true };

  if (temp <= 99.5) return { score: 0 };
  if (temp <= 100.9) return { score: 1 };
  if (temp >= 101) return { score: 2 };

  return { score: 0 };
}

function ageScore(age) {
  if (typeof age !== "number") return { score: 0, invalid: true };

  if (age < 40) return { score: 0 };
  if (age <= 65) return { score: 1 };
  if (age > 65) return { score: 2 };

  return { score: 0 };
}

/* ---------------- ANALYSIS ---------------- */

function analyzePatients(patients) {

  const highRisk = [];
  const fever = [];
  const dataIssues = [];

  for (const p of patients) {

    const bp = bpScore(p.blood_pressure);
    const temp = tempScore(p.temperature);
    const age = ageScore(p.age);

    const total = bp.score + temp.score + age.score;

    if (total >= 4) highRisk.push(p.patient_id);

    if (typeof p.temperature === "number" && p.temperature >= 99.6) {
      fever.push(p.patient_id);
    }

    if (bp.invalid || temp.invalid || age.invalid) {
      dataIssues.push(p.patient_id);
    }
  }

  return {
    high_risk_patients: highRisk,
    fever_patients: fever,
    data_quality_issues: dataIssues
  };
}

/* ---------------- SUBMIT RESULTS ---------------- */

async function submitAssessment(results) {

  const response = await axios.post(
    `${BASE_URL}/submit-assessment`,
    results,
    {
      headers: {
        "x-api-key": API_KEY,
        "Content-Type": "application/json"
      }
    }
  );

  console.log("\nAssessment Response:");
  console.log(JSON.stringify(response.data, null, 2));
}

/* ---------------- MAIN ---------------- */

async function main() {

  console.log("Starting patient fetch...");

  const patients = await fetchAllPatients();

  console.log(`Total patients fetched: ${patients.length}`);

  const results = analyzePatients(patients);

  console.log("\nSubmitting results...");
  
  await submitAssessment(results);
}

main();