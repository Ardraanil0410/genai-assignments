const webhookUrl = "http://localhost:5678/webhook-test/userstory_reviewer";

const reviewForm = document.querySelector("#review-form");
const storyKeyInput = document.querySelector("#story-key");
const keyHint = document.querySelector("#key-hint");
const inputWrap = document.querySelector(".input-wrap");
const reviewCard = document.querySelector(".review-card");
const reviewButton = document.querySelector(".review-button");
const buttonLabel = document.querySelector(".button-label");
const resultState = document.querySelector("#result-state");
const resultCard = document.querySelector(".result-card");
const emptyIllustration = document.querySelector("#empty-illustration");
const reviewLoader = document.querySelector("#review-loader");
const reviewStatusTitle = document.querySelector("#review-status-title");
const resultNote = document.querySelector("#result-note");
const reviewOutput = document.querySelector("#review-output");
const analysisStatus = document.querySelector("#analysis-status");

const defaultKeyHint = "Find the key at the top of your Jira issue.";
const progressMessages = [
  "Reading story key...",
  "Contacting Jira API...",
  "Evaluating description clarity...",
  "Synthesizing recommendations...",
];

function shakeReviewCard() {
  reviewCard.classList.remove("is-shaking");
  void reviewCard.offsetWidth;
  reviewCard.classList.add("is-shaking");
}

function clearValidationMessage() {
  storyKeyInput.removeAttribute("aria-invalid");
  inputWrap.classList.remove("is-error");
  keyHint.classList.remove("is-error");
  keyHint.textContent = defaultKeyHint;
  reviewCard.classList.remove("is-shaking");
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

function formatInlineMarkdown(value) {
  const escaped = escapeHtml(value);
  return escaped.replace(/(`[^`]+`|\*\*.+?\*\*|__.+?__)/g, (token) => {
    if (token.startsWith("`")) {
      return `<code class="markdown-inline-code">${token.slice(1, -1)}</code>`;
    }
    return `<strong>${token.slice(2, -2)}</strong>`;
  });
}

function splitTableRow(row) {
  const cells = [];
  let cell = "";
  const source = row.trim();

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && ["|", "\\"].includes(source[index + 1])) {
      cell += source[index + 1];
      index += 1;
    } else if (character === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += character;
    }
  }

  cells.push(cell.trim());
  if (!cells[0]) cells.shift();
  if (!cells[cells.length - 1]) cells.pop();
  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function formatReviewMarkdown(markdown) {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let listType = "";
  let listItems = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${paragraph.map(formatInlineMarkdown).join("<br>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listItems.length) return;
    const tag = listType === "ordered" ? "ol" : "ul";
    blocks.push(
      `<${tag} class="markdown-list">${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join("")}</${tag}>`,
    );
    listType = "";
    listItems = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();

    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushList();
      const language = trimmed.slice(3).trim();
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
        codeLines.push(lines[index]);
        index += 1;
      }
      const languageLabel = language
        ? `<span class="markdown-code-language">${escapeHtml(language)}</span>`
        : "";
      blocks.push(
        `<figure class="markdown-code-block">${languageLabel}<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre></figure>`,
      );
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph();
      flushList();
      const tag = heading[1].length <= 2 ? "h3" : "h4";
      blocks.push(`<${tag}>${formatInlineMarkdown(heading[2])}</${tag}>`);
      continue;
    }

    if (index + 1 < lines.length && isTableSeparator(lines[index + 1]) && trimmed.includes("|")) {
      flushParagraph();
      flushList();
      const headers = splitTableRow(line);
      const rows = [];
      index += 2;
      while (index < lines.length && lines[index].trim().includes("|")) {
        rows.push(splitTableRow(lines[index]));
        index += 1;
      }
      index -= 1;
      const headerHtml = headers.map((cell) => `<th>${formatInlineMarkdown(cell)}</th>`).join("");
      const rowsHtml = rows
        .map((row) => {
          const cells = headers.map((_, cellIndex) => row[cellIndex] ?? "");
          return `<tr>${cells.map((cell) => `<td>${formatInlineMarkdown(cell)}</td>`).join("")}</tr>`;
        })
        .join("");
      blocks.push(
        `<div class="markdown-table-wrap"><table class="markdown-table"><thead><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`,
      );
      continue;
    }

    const listItem = trimmed.match(/^(?:[-*+]|\d+[.)])\s+(.+)$/);
    if (listItem) {
      flushParagraph();
      const itemType = /^\d/.test(trimmed) ? "ordered" : "unordered";
      if (listType && listType !== itemType) flushList();
      listType = itemType;
      listItems.push(listItem[1]);
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    flushList();
    paragraph.push(line.trimEnd());
  }

  flushParagraph();
  flushList();
  return blocks.join("");
}

function showResult(title, message, state, stateLabel) {
  resultCard.dataset.state = state;
  emptyIllustration.hidden = state !== "idle";
  reviewLoader.hidden = state !== "loading";
  resultNote.hidden = state !== "success";
  reviewStatusTitle.textContent = title;
  if (state === "success") {
    reviewOutput.innerHTML = formatReviewMarkdown(message);
  } else {
    reviewOutput.textContent = message;
  }
  reviewOutput.classList.toggle("has-review", state === "success");
  resultState.textContent = state === "success" ? "Analysis Complete" : stateLabel;
}

function extractReview(value, depth = 0) {
  if (depth > 8 || value == null) return "";

  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return "";

    if (text.startsWith("{") || text.startsWith("[")) {
      try {
        const parsed = JSON.parse(text);
        if (typeof parsed !== "string" || parsed !== text) {
          return extractReview(parsed, depth + 1);
        }
      } catch {
        return text;
      }
    }

    return text;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const review = extractReview(item, depth + 1);
      if (review) return review;
    }
    return "";
  }

  if (typeof value === "object") {
    const preferredKeys = [
      "review",
      "output",
      "text",
      "response",
      "result",
      "content",
      "data",
    ];

    for (const key of preferredKeys) {
      if (key in value) {
        const review = extractReview(value[key], depth + 1);
        if (review) return review;
      }
    }

    for (const [key, nestedValue] of Object.entries(value)) {
      if (["error", "errors", "status", "statusCode"].includes(key)) continue;
      const review = extractReview(nestedValue, depth + 1);
      if (review) return review;
    }
  }

  return "";
}

storyKeyInput.addEventListener("input", clearValidationMessage);
storyKeyInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    reviewForm.requestSubmit();
  }
});

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const storyKey = storyKeyInput.value.trim();
  if (!storyKey) {
    storyKeyInput.setAttribute("aria-invalid", "true");
    inputWrap.classList.add("is-error");
    keyHint.classList.add("is-error");
    keyHint.textContent = "Please enter a Jira story key to start your review.";
    shakeReviewCard();
    storyKeyInput.focus();
    return;
  }

  clearValidationMessage();
  storyKeyInput.disabled = true;
  inputWrap.classList.add("is-disabled");
  reviewButton.disabled = true;
  reviewButton.setAttribute("aria-busy", "true");
  resultCard.setAttribute("aria-busy", "true");
  buttonLabel.textContent = "Analyzing...";
  analysisStatus.textContent = progressMessages[0];
  reviewOutput.classList.remove("has-review");
  showResult(
    "Reviewing your story...",
    "Please wait while the AI review is being generated.",
    "loading",
    "In progress",
  );

  let progressIndex = 0;
  const progressTimer = window.setInterval(() => {
    progressIndex = (progressIndex + 1) % progressMessages.length;
    analysisStatus.classList.remove("is-changing");
    analysisStatus.textContent = progressMessages[progressIndex];
    requestAnimationFrame(() => analysisStatus.classList.add("is-changing"));
  }, 1500);

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ storyKey }),
    });

    if (!response.ok) {
      throw new Error(`The n8n webhook returned HTTP ${response.status}.`);
    }

    const responseText = await response.text();
    let responseData = responseText;
    try {
      responseData = JSON.parse(responseText);
    } catch {
      // Plain-text responses are valid review content.
    }

    const review = extractReview(responseData);
    if (!review) {
      throw new Error("The webhook response did not contain a review.");
    }

    showResult("Your AI review", review, "success", "Review complete");
  } catch (error) {
    console.error("Unable to retrieve the Jira story review:", error);
    const errorMessage =
      error.message === "The webhook response did not contain a review."
        ? "The n8n service responded, but no review was found. Check the workflow's response output and try again."
        : error.message.startsWith("The n8n webhook returned HTTP")
          ? `${error.message} Check that the n8n workflow is active, then try again.`
          : "We couldn't connect to the n8n review service. Check that n8n is running and the webhook is active, then try again.";
    showResult(
      "Review couldn't be completed",
      errorMessage,
      "error",
      "Review failed",
    );
  } finally {
    window.clearInterval(progressTimer);
    storyKeyInput.disabled = false;
    inputWrap.classList.remove("is-disabled");
    reviewButton.disabled = false;
    reviewButton.removeAttribute("aria-busy");
    resultCard.removeAttribute("aria-busy");
    buttonLabel.textContent = "Review story";
    analysisStatus.classList.remove("is-changing");
  }
});
