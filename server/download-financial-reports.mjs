import { chromium } from "playwright";
import * as fs from "fs";
import * as path from "path";

const FINANCIAL_REPORTS_DIR = path.join(
  path.dirname(new URL(import.meta.url).pathname.substring(1)),
  "financial-reports"
);

// EGX companies and their latest IR page URLs for quarterly reports
const companies = [
  {
    symbol: "ETEL",
    name: "Telecom Egypt",
    url: "https://ir.te.eg/en/FinancialInformation/QuarterlyResults"
  },
  {
    symbol: "COMI",
    name: "Commercial International Bank",
    url: "https://www.cibeg.com/en/investor-relations/quarterly-results"
  },
  {
    symbol: "SWDY",
    name: "El Sewedy Electric",
    url: "https://ir.elsewedyelectric.com/en/results-center"
  },
  {
    symbol: "TMGH",
    name: "Talaat Moustafa Group",
    url: "https://ir.tmg-heliopolis.com/"
  },
  {
    symbol: "FWRY",
    name: "Fawry for Banking Technology",
    url: "https://english.mubasher.info/markets/EGX/stocks/FWRY/financial-statements"
  },
  {
    symbol: "HRHO",
    name: "EFG Hermes Holding",
    url: "https://www.efghermes.com/en/investor-center/financial-results"
  },
  {
    symbol: "PHDC",
    name: "Palm Hills Developments",
    url: "https://english.mubasher.info/markets/EGX/stocks/PHDC/financial-statements"
  },
  {
    symbol: "ABUK",
    name: "Abu Qir Fertilizers & Chemical",
    url: "https://english.mubasher.info/markets/EGX/stocks/ABUK/financial-statements"
  },
  {
    symbol: "EAST",
    name: "Eastern Company",
    url: "https://english.mubasher.info/markets/EGX/stocks/EAST/financial-statements"
  },
  {
    symbol: "JUFO",
    name: "Juhayna Food Industries",
    url: "https://english.mubasher.info/markets/EGX/stocks/JUFO/financial-statements"
  },
  {
    symbol: "HDBK",
    name: "Housing & Development Bank",
    url: "https://english.mubasher.info/markets/EGX/stocks/HDBK/financial-statements"
  },
  {
    symbol: "VALU",
    name: "U Consumer Finance",
    url: "https://english.mubasher.info/markets/EGX/stocks/VALU/financial-statements"
  },
  {
    symbol: "MFPC",
    name: "Misr Fertilizers Production Company",
    url: "https://english.mubasher.info/markets/EGX/stocks/MFPC/financial-statements"
  },
  {
    symbol: "EGAL",
    name: "Egypt Aluminum",
    url: "https://english.mubasher.info/markets/EGX/stocks/EGAL/financial-statements"
  },
  {
    symbol: "ESRS",
    name: "Ezz Steel",
    url: "https://english.mubasher.info/markets/EGX/stocks/ESRS/financial-statements"
  },
  {
    symbol: "EFID",
    name: "Edita Food Industries",
    url: "https://english.mubasher.info/markets/EGX/stocks/EFID/financial-statements"
  },
  {
    symbol: "CIRA",
    name: "Cairo for Investment & Real Estate Development",
    url: "https://english.mubasher.info/markets/EGX/stocks/CIRA/financial-statements"
  },
  {
    symbol: "CLHO",
    name: "Cleopatra Hospital",
    url: "https://english.mubasher.info/markets/EGX/stocks/CLHO/financial-statements"
  },
  {
    symbol: "ORWE",
    name: "Oriental Weavers Carpet",
    url: "https://english.mubasher.info/markets/EGX/stocks/ORWE/financial-statements"
  },
  {
    symbol: "SKPC",
    name: "Sidi Kerir Petrochemicals",
    url: "https://english.mubasher.info/markets/EGX/stocks/SKPC/financial-statements"
  }
];

let totalQuarters = companies.length * 8; // 8 quarters per company
let completedQuarters = 0;

(async () => {
  console.log(`🚀 Equra AI Financial Reports Download Bot`);
  console.log(`📊 Found ${companies.length} companies, need ${totalQuarters} quarters total`);
  console.log(`\nThis script will open each company's IR page in your browser.`);
  console.log(`1. Download the PDFs for each quarter (Q3 2024 → Q4 2025)`);
  console.log(`2. Save them to the correct folder: c:\Repos\equra-ai-backend\server\financial-reports\{SYMBOL}\`);
  console.log(`3. Press ENTER when you're done with each company to move to the next\n`);
  console.log(`Starting browser automation...`);

  const browser = await chromium.launch({
    headless: false,
    slowMo: 100 // Make it more visible to user
  });

  const context = await browser.newContext({
    storageState: undefined, // Fresh browser
    ignoreHTTPSErrors: true,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i];
    const symbolDir = path.join(FINANCIAL_REPORTS_DIR, company.symbol);
    
    // Create company directory if it doesn't exist
    if (!fs.existsSync(symbolDir)) {
      fs.mkdirSync(symbolDir, { recursive: true });
    }

    console.log(`\n┌ ${i + 1}/${companies.length} ── ${company.name} (${company.symbol}) ── ${company.url}`);
    console.log(`│ Save your PDFs to: ${symbolDir}`);
    console.log(`│ Need: Q3 2024, Q4 2024, Q1 2025, Q2 2025, Q3 2025, Q4 2025, plus annual reports`);
    console.log(`└───────────────────────────────────────────────────────────────────────────`);

    const page = await context.newPage();
    
    try {
      await page.goto(company.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      
      // Wait for the page to load something useful
      await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      
      console.log(`\n✅ Page loaded! Now:`);
      console.log(`   1. Navigate to the quarterly/annual reports section`);
      console.log(`   2. Download PDFs for Q3 2024 → Q4 2025 (8+ files)`);
      console.log(`   3. Save them to: ${symbolDir}`);
      console.log(`\n   Press ENTER when you're done downloading files for ${company.symbol}`);

      // Wait for user input
      await new Promise(resolve => {
        const stdin = process.stdin;
        stdin.setRawMode(true);
        stdin.resume();
        stdin.on('data', function(data) {
          if (data.toString() === '\r' || data.toString() === '\n') { // Enter key
            stdin.setRawMode(false);
            stdin.pause();
            resolve();
          }
        });
      });

      // Count files in the folder to track progress
      const fileCount = fs.readdirSync(symbolDir).filter(f => f.toLowerCase().endsWith('.pdf')).length;
      completedQuarters += fileCount;
      
      console.log(`\n📊 Completed ${company.symbol}: saved ${fileCount} files (${Math.round(completedQuarters / totalQuarters * 100 * 10) / 10}% overall)`);

    } catch (error) {
      console.error(`❌ Error with ${company.symbol}: ${error.message}`);
      console.log(`   This might be a CAPTCHA or bot protection. Try visiting the URL manually.`);
      
      // Option to skip or retry
      const response = await askQuestion(`Skip ${company.symbol} or retry? (skip/retry): `);
      if (response.toLowerCase() === 'skip') {
        continue;
      }
    }

    await page.close();
  }

  console.log(`\n🎉 All companies processed!`);
  console.log(`📊 You collected ${completedQuarters} file(s) out of ${totalQuarters} quarters expected`);
  console.log(`📁 All reports saved to: ${FINANCIAL_REPORTS_DIR}`);
  
  await browser.close();
  process.exit(0);
})();

function askQuestion(question) {
  return new Promise((resolve) => {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}