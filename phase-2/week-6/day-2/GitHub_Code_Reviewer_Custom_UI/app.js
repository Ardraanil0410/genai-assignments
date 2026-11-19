"use strict";

const form = document.querySelector(".review-form");
const fileInput = document.querySelector("#github-url");
const submitButton = document.querySelector(".review-button");
const buttonLabel = document.querySelector(".button-label");
const fieldError = document.querySelector("#url-error");
const availabilityNote = document.querySelector(".availability-note");
const connectionStatus = document.querySelector(".connection-status");
const connectionValue = document.querySelector(".connection-value");
const connectionLock = document.querySelector(".connection-lock");
const workspaceMode = document.querySelector(".workspace-mode-label");
const workspaceFooterStatus = document.querySelector(".workspace-footer-status");
const summaryFile = document.querySelector(".summary-card:nth-child(2) .summary-value");
const summaryFileDetail = document.querySelector(".summary-card:nth-child(2) .summary-detail");
const summaryScore = document.querySelector(".summary-card:first-child .summary-value");
const summaryScoreDetail = document.querySelector(".summary-card:first-child .summary-detail");
const summaryStatus = document.querySelector(".summary-card:nth-child(3) .summary-value");
const summaryStatusDetail = document.querySelector(".summary-card:nth-child(3) .summary-detail");
const waitingState = document.querySelector(".waiting-state");
const loadingState = document.querySelector(".loading-state");
const errorState = document.querySelector(".error-state");
const successState = document.querySelector(".success-state");
const errorMessage = document.querySelector(".error-message");
const retryButton = document.querySelector(".retry-button");
const reviewMarkdown = document.querySelector(".review-markdown");

let isSubmitting = false;
let hasInteracted = false;
let proxyAvailable = false;
let lastNormalizedUrl = "";

function decodePathSegment(segment) {
  let decoded;
  try {
    decoded = decodeURIComponent(segment);
  } catch {
    throw new Error("The GitHub file URL contains an invalid encoded path.");
  }

  if (
    !decoded ||
    decoded === "." ||
    decoded === ".." ||
    /[\\/\u0000-\u001f\u007f]/.test(decoded) ||
    /%(?:2f|5c|2e)/i.test(decoded)
  ) {
    throw new Error("The URL must point to a specific file path in a public GitHub repository.");
  }

  return decoded;
}

function normalizeFileUrl(value) {
  const input = value.trim();
  if (!input) {
    throw new Error("Paste a GitHub file URL to start a review.");
  }

  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Enter a valid HTTPS GitHub file URL.");
  }

  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.search
  ) {
    throw new Error("Use an HTTPS GitHub file URL without credentials or query parameters.");
  }

  const segments = url.pathname.split("/").slice(1);
  let rawSegments;

  if (url.hostname === "github.com") {
    if (segments[2] === "pull") {
      throw new Error("Pull request URLs are not supported. Paste a direct file link from the repository instead.");
    }
    if (segments.length < 3 || (segments.length === 3 && !segments[2])) {
      throw new Error("Repository home-page links do not identify a file. Paste a /owner/repo/blob/branch/path link.");
    }
    if (segments.length < 5 || decodePathSegment(segments[2]) !== "blob") {
      throw new Error("Use a direct GitHub file link in the form /owner/repo/blob/branch/path.");
    }

    rawSegments = [
      decodePathSegment(segments[0]),
      decodePathSegment(segments[1]),
      decodePathSegment(segments[3]),
      ...segments.slice(4).map(decodePathSegment),
    ];
  } else if (url.hostname === "raw.githubusercontent.com") {
    if (segments.length < 4) {
      throw new Error("The raw GitHub URL must include an owner, repository, branch, and file path.");
    }

    rawSegments = segments.map(decodePathSegment);
  } else {
    throw new Error("Only github.com file links and raw.githubusercontent.com file links are supported.");
  }

  if (
    rawSegments[0] === "." ||
    rawSegments[0] === ".." ||
    rawSegments[1] === "." ||
    rawSegments[1] === ".." ||
    rawSegments.length < 4
  ) {
    throw new Error("The URL must include an owner, repository, branch, and file path.");
  }

  return `https://raw.githubusercontent.com/${rawSegments.map(encodeURIComponent).join("/")}`;
}

function setFieldError(message) {
  fieldError.textContent = message;
  fieldError.hidden = !message;
  fileInput.setAttribute("aria-invalid", message ? "true" : "false");
}

function updateSubmitButton() {
  let isValid = false;
  try {
    normalizeFileUrl(fileInput.value);
    isValid = true;
  } catch {
    isValid = false;
  }

  submitButton.disabled = isSubmitting || !proxyAvailable || !isValid;
}

function showWorkspaceState(state) {
  for (const candidate of [waitingState, loadingState, errorState, successState]) {
    candidate.hidden = candidate !== state;
  }
}

function setWorkspaceStatus(label, footer, summary, detail) {
  workspaceMode.textContent = label;
  workspaceMode.parentElement.dataset.state =
    label === "ANALYZING" ? "loading" : label.includes("ERROR") || label === "INPUT NEEDED" ? "error" : label === "ANALYSIS COMPLETE" ? "success" : "ready";
  summaryStatus.classList.toggle("status-awaiting", label === "READY");
  summaryStatus.classList.toggle("status-complete", label === "ANALYSIS COMPLETE");
  workspaceFooterStatus.textContent = footer;
  summaryStatus.textContent = summary;
  summaryStatusDetail.textContent = detail;
}

function resetReviewResult() {
  reviewMarkdown.replaceChildren();
  summaryScore.textContent = "—";
  summaryScore.classList.remove("summary-text");
  summaryScoreDetail.textContent = "Available after a review";
  summaryFile.textContent = "None yet";
  summaryFile.removeAttribute("title");
  summaryFileDetail.textContent = "No file submitted";
  errorMessage.textContent = "";
  showWorkspaceState(waitingState);
  setWorkspaceStatus("READY", "Awaiting review", "Awaiting review", "No review submitted");
}

function setConnected() {
  connectionStatus.dataset.connected = "true";
  connectionStatus.setAttribute("aria-label", "n8n connection: Connected. An HTTP response was received from n8n.");
  connectionStatus.title = "An HTTP response was received from n8n.";
  connectionValue.textContent = "Connected";
}

function showValidationError(message) {
  setFieldError(message);
  errorMessage.textContent = `${message} Correct the URL and retry.`;
  showWorkspaceState(errorState);
  setWorkspaceStatus("INPUT NEEDED", "Check the file URL", "Invalid URL", "A public GitHub file link is required");
  retryButton.textContent = "Try again";
  retryButton.dataset.retry = "validation";
}

function setLoading(isLoading) {
  isSubmitting = isLoading;
  fileInput.disabled = isLoading;
  submitButton.classList.toggle("is-loading", isLoading);
  submitButton.setAttribute("aria-busy", String(isLoading));
  buttonLabel.textContent = isLoading ? "Analyzing..." : "Review Code";
  if (isLoading) {
    retryButton.disabled = true;
  } else {
    retryButton.disabled = false;
  }
  updateSubmitButton();
}

function getErrorMessage(responseText, status) {
  const detail = responseText.trim().slice(0, 500);
  if (!detail) {
    return `The review workflow returned HTTP ${status} without an error message. Check the n8n workflow and try again.`;
  }
  return `The review workflow returned HTTP ${status}: ${detail}`;
}

function extractOverallScore(review) {
  const scorePattern =
    /^\s*(?:#{1,6}\s*)?(?:[-*]\s*)?\*{0,2}Overall\s+Score\*{0,2}\s*:?\*{0,2}\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*\*{0,2}\s*$/im;
  const match = review.match(scorePattern);
  if (!match) {
    return null;
  }

  const score = Number(match[1]);
  const maximum = Number(match[2]);
  if (!Number.isFinite(score) || !Number.isFinite(maximum) || maximum <= 0 || score < 0 || score > maximum) {
    return null;
  }

  return Number(((score / maximum) * 100).toFixed(2));
}

function appendInlineMarkdown(parent, text) {
  const tokenPattern = /(`+)([^`]+?)\1|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*]+)\*|_([^_]+)_/g;
  let cursor = 0;
  let match;

  while ((match = tokenPattern.exec(text))) {
    parent.append(document.createTextNode(text.slice(cursor, match.index)));
    if (match[2] !== undefined) {
      const code = document.createElement("code");
      code.textContent = match[2];
      parent.append(code);
    } else {
      const element = document.createElement(match[3] !== undefined || match[4] !== undefined ? "strong" : "em");
      appendInlineMarkdown(element, match[3] ?? match[4] ?? match[5] ?? match[6]);
      parent.append(element);
    }
    cursor = tokenPattern.lastIndex;
  }

  parent.append(document.createTextNode(text.slice(cursor)));
}

function splitTableRow(line) {
  const cells = [];
  let cell = "";
  let escaped = false;
  let source = line.trim();

  if (source.startsWith("|")) source = source.slice(1);
  if (source.endsWith("|") && !source.endsWith("\\|")) source = source.slice(0, -1);

  for (const character of source) {
    if (escaped) {
      cell += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableDelimiter(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function appendTable(parent, headerLine, delimiterLine, bodyLines) {
  const headers = splitTableRow(headerLine);
  const alignments = splitTableRow(delimiterLine).map((cell) =>
    cell.startsWith(":") && cell.endsWith(":") ? "center" : cell.endsWith(":") ? "right" : cell.startsWith(":") ? "left" : "",
  );
  const wrapper = document.createElement("div");
  wrapper.className = "review-table-wrap";
  const table = document.createElement("table");
  table.className = "review-table";
  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");

  headers.forEach((value, index) => {
    const cell = document.createElement("th");
    cell.scope = "col";
    if (alignments[index]) cell.style.textAlign = alignments[index];
    appendInlineMarkdown(cell, value);
    headerRow.append(cell);
  });
  thead.append(headerRow);
  table.append(thead);

  const tbody = document.createElement("tbody");
  for (const line of bodyLines) {
    const values = splitTableRow(line);
    const row = document.createElement("tr");
    headers.forEach((_, index) => {
      const cell = document.createElement("td");
      if (alignments[index]) cell.style.textAlign = alignments[index];
      appendInlineMarkdown(cell, values[index] || "");
      row.append(cell);
    });
    tbody.append(row);
  }
  table.append(tbody);
  wrapper.append(table);
  parent.append(wrapper);
}

function renderMarkdown(markdown, container) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const fencePattern = /^ {0,3}(`{3,}|~{3,})(.*)$/;
  const headingPattern = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
  const listPattern = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/;
  const rulePattern = /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/;

  function isBlockStart(index) {
    const line = lines[index];
    return (
      fencePattern.test(line) ||
      headingPattern.test(line) ||
      listPattern.test(line) ||
      rulePattern.test(line) ||
      /^\s*>/.test(line) ||
      (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1]))
    );
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(fencePattern);
    if (fence) {
      const fenceCharacter = fence[1][0];
      const fenceLength = fence[1].length;
      const codeLines = [];
      index += 1;
      while (index < lines.length && !new RegExp(`^ {0,3}${fenceCharacter}{${fenceLength},}\\s*$`).test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      const pre = document.createElement("pre");
      pre.className = "review-code-block";
      const code = document.createElement("code");
      const language = fence[2].trim().split(/\s+/, 1)[0];
      if (/^[\w+-]+$/.test(language)) code.classList.add(`language-${language}`);
      code.textContent = codeLines.join("\n");
      pre.append(code);
      container.append(pre);
      continue;
    }

    const heading = line.match(headingPattern);
    if (heading) {
      const element = document.createElement(`h${heading[1].length}`);
      appendInlineMarkdown(element, heading[2]);
      container.append(element);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableDelimiter(lines[index + 1])) {
      const bodyLines = [];
      index += 2;
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        bodyLines.push(lines[index]);
        index += 1;
      }
      appendTable(container, line, lines[index - bodyLines.length - 1], bodyLines);
      continue;
    }

    const listItem = line.match(listPattern);
    if (listItem) {
      const ordered = listItem[2] !== undefined;
      const list = document.createElement(ordered ? "ol" : "ul");
      if (ordered && Number(listItem[2]) > 1) list.start = Number(listItem[2]);
      while (index < lines.length) {
        const item = lines[index].match(listPattern);
        if (!item || (item[2] !== undefined) !== ordered) break;
        const element = document.createElement("li");
        appendInlineMarkdown(element, item[3]);
        list.append(element);
        index += 1;
      }
      container.append(list);
      continue;
    }

    if (/^\s*>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      const quote = document.createElement("blockquote");
      appendInlineMarkdown(quote, quoteLines.join(" "));
      container.append(quote);
      continue;
    }

    if (rulePattern.test(line)) {
      container.append(document.createElement("hr"));
      index += 1;
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim() && (paragraphLines.length === 0 || !isBlockStart(index))) {
      paragraphLines.push(lines[index].trim());
      index += 1;
    }
    const paragraph = document.createElement("p");
    appendInlineMarkdown(paragraph, paragraphLines.join(" "));
    container.append(paragraph);
  }
}

async function submitReview(value = fileInput.value) {
  hasInteracted = true;
  let fileUrl;
  try {
    fileUrl = normalizeFileUrl(value);
  } catch (error) {
    showValidationError(error.message);
    updateSubmitButton();
    return;
  }

  if (!proxyAvailable) {
    showValidationError("Open this page through the local development server (node server.js) to connect to n8n.");
    return;
  }

  lastNormalizedUrl = fileUrl;
  fileInput.value = value.trim();
  setFieldError("");
  resetReviewResult();
  setLoading(true);
  showWorkspaceState(loadingState);
  setWorkspaceStatus("ANALYZING", "Analyzing...", "Analyzing...", "Waiting for the review response");
  retryButton.dataset.retry = "review";

  try {
    const response = await fetch("/api/review", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileUrl }),
    });

    if (response.headers.get("X-N8n-Reachable") === "true") {
      setConnected();
    }

    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(getErrorMessage(responseText, response.status));
    }

    let payload;
    try {
      payload = JSON.parse(responseText);
    } catch {
      throw new Error("The workflow returned a successful HTTP status, but its response was not valid JSON. Try again or check the n8n response.");
    }

    if (!payload || typeof payload.review !== "string" || !payload.review.trim()) {
      throw new Error("The workflow response did not contain a nonempty review. It may have returned an empty result; try again or check the workflow output.");
    }

    renderMarkdown(payload.review.trim(), reviewMarkdown);
    const overallScore = extractOverallScore(payload.review);
    summaryScore.textContent = overallScore === null ? "Not provided" : `${overallScore}%`;
    summaryScore.classList.toggle("summary-text", overallScore === null);
    summaryScoreDetail.textContent = overallScore === null ? "No overall score in response" : "From returned review";
    const pathParts = new URL(fileUrl).pathname.split("/");
    const fileName = decodeURIComponent(pathParts[pathParts.length - 1]);
    summaryFile.textContent = fileName || "File reviewed";
    summaryFile.title = fileUrl;
    summaryFileDetail.textContent = "Review response received";
    showWorkspaceState(successState);
    setWorkspaceStatus("ANALYSIS COMPLETE", "Analysis Complete", "Analysis Complete", "Source coverage was not confirmed");
  } catch (error) {
    errorMessage.textContent =
      error instanceof TypeError
        ? "Could not reach the local review proxy. Start the server and n8n, then retry."
        : error.message;
    showWorkspaceState(errorState);
    setWorkspaceStatus("REVIEW ERROR", "Review failed", "Review failed", "No review result was received");
  } finally {
    setLoading(false);
    updateSubmitButton();
  }
}

fileInput.addEventListener("input", () => {
  hasInteracted = true;
  try {
    normalizeFileUrl(fileInput.value);
    setFieldError("");
    if (!successState.hidden || !errorState.hidden) {
      resetReviewResult();
    }
  } catch (error) {
    setFieldError(error.message);
  }
  updateSubmitButton();
});

fileInput.addEventListener("blur", () => {
  hasInteracted = true;
  if (!fileInput.value.trim()) {
    setFieldError("Paste a GitHub file URL to start a review.");
    return;
  }
  try {
    normalizeFileUrl(fileInput.value);
    setFieldError("");
  } catch (error) {
    setFieldError(error.message);
  }
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  if (!isSubmitting) {
    void submitReview();
  }
});

retryButton.addEventListener("click", () => {
  if (retryButton.dataset.retry === "validation") {
    fileInput.focus();
    fileInput.dispatchEvent(new Event("blur"));
    return;
  }
  void submitReview(lastNormalizedUrl || fileInput.value);
});

async function loadDevelopmentConfig() {
  if (location.protocol === "file:") {
    availabilityNote.textContent = "Open this page through the local development server (node server.js) to connect to n8n.";
    connectionLock.hidden = true;
    updateSubmitButton();
    return;
  }

  try {
    const response = await fetch("/api/config");
    if (!response.ok) {
      throw new Error(`Local development server returned HTTP ${response.status}.`);
    }
    const config = await response.json();
    if (config.mode === "test") {
      workspaceMode.textContent = "TEST LISTENER";
    } else {
      workspaceMode.textContent = "READY";
    }
    proxyAvailable = true;
    availabilityNote.textContent = "Enter a valid public file URL to enable review.";
    connectionLock.hidden = true;
  } catch {
    proxyAvailable = false;
    availabilityNote.textContent = "Could not reach the local review server. Start it with node server.js.";
    connectionLock.hidden = true;
  }
  updateSubmitButton();
}

void loadDevelopmentConfig();
