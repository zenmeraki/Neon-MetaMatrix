import axios from "axios";
import readline from "readline";

/**
 * JSONL stream utilities.
 *
 * Responsibilities:
 * - download remote JSONL/NDJSON as a Node stream
 * - parse JSONL streams line-by-line without loading whole files
 */

const DEFAULT_ACCEPT = "application/x-ndjson";

export const downloadJsonlStream = async ({
  sourceUrl,
  accept = DEFAULT_ACCEPT,
  errorLabel = "JSONL artifact",
}) => {
  if (!sourceUrl || typeof sourceUrl !== "string") {
    throw new Error("sourceUrl is required");
  }

  const response = await axios.get(new URL(sourceUrl).toString(), {
    headers: {
      Accept: accept,
    },
    responseType: "stream",
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download ${errorLabel}. status=${response.status}`);
  }

  return response.data;
};

export async function* parseJsonlStream(dataStream) {
  if (!dataStream) {
    throw new Error("dataStream is required");
  }

  const rl = readline.createInterface({
    input: dataStream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;

  for await (const line of rl) {
    lineNumber += 1;

    if (!line.trim()) {
      continue;
    }

    try {
      yield {
        lineNumber,
        value: JSON.parse(line),
      };
    } catch (error) {
      const parseError = new Error(
        `JSONL parse error at line ${lineNumber}: ${error.message}`,
      );
      parseError.code = "JSONL_PARSE_ERROR";
      parseError.lineNumber = lineNumber;
      throw parseError;
    }
  }
}

