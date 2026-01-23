#!/usr/bin/env node

import { multiGoogleSearch } from "./services/googleSearch.js";
import { logger } from "./utils/logger.js";

const isDebugMode = process.argv.includes("--debug");
const isLogMode = process.argv.includes("--log");

async function main() {
  // Filter out flags and node/script paths
  const args = process.argv.slice(2).filter(arg => !arg.startsWith("--"));
  
  if (args.length === 0) {
    console.log("Usage: g-search-cli <query1> [query2] ... [--debug] [--log]");
    process.exit(1);
  }

  if (isLogMode) {
    logger.info(`[CLI] Starting search for: ${args.join(", ")}`);
  }

  try {
    const results = await multiGoogleSearch(args, { debug: isDebugMode });
    
    results.forEach((searchResponse, index) => {
      if (args.length > 1) {
        console.log(`\n=== Results for: ${searchResponse.query} ===`);
      }
      
      if (searchResponse.results.length === 0) {
        console.log("No results found.");
      } else {
        searchResponse.results.forEach((result, i) => {
          console.log(`${i + 1}. ${result.title}`);
          console.log(`   ${result.link}`);
          console.log(`   ${result.snippet}\n`);
        });
      }
    });
  } catch (error) {
    console.error("Error during search:", error);
    process.exit(1);
  }
}

main();
