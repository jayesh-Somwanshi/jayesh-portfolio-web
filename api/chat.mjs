import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CohereClientV2 } from "cohere-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CHAT_MODEL = process.env.COHERE_MODEL || "command-a-03-2025";
const EMBEDDING_MODEL = process.env.COHERE_EMBEDDING_MODEL || "embed-v4.0";
const KNOWLEDGE_FILE = path.join(__dirname, "..", "data", "portfolio.md");

let cohere;
let vectorIndexPromise;

function assertCohereApiKey() {
  if (!process.env.COHERE_API_KEY) {
    throw new Error("Missing COHERE_API_KEY. Add it in your deployment environment variables.");
  }
}

function getCohereClient() {
  assertCohereApiKey();

  if (!cohere) {
    cohere = new CohereClientV2({
      token: process.env.COHERE_API_KEY,
    });
  }

  return cohere;
}

function chunkMarkdown(markdown) {
  const sections = markdown
    .split(/\n(?=##\s+)/g)
    .map((section) => section.trim())
    .filter(Boolean);

  return sections.map((section, index) => {
    const headingMatch = section.match(/^#+\s+(.+)$/m);
    return {
      id: `portfolio-${index + 1}`,
      title: headingMatch?.[1] || "Portfolio",
      text: section,
    };
  });
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function embedTexts(texts, inputType) {
  const response = await getCohereClient().embed({
    texts,
    model: EMBEDDING_MODEL,
    inputType,
    embeddingTypes: ["float"],
  });

  return response.embeddings.float || [];
}

async function buildVectorIndex() {
  const markdown = await fs.readFile(KNOWLEDGE_FILE, "utf8");
  const chunks = chunkMarkdown(markdown);
  const embeddings = await embedTexts(
    chunks.map((chunk) => `${chunk.title}\n${chunk.text}`),
    "search_document"
  );

  return {
    embeddingModel: EMBEDDING_MODEL,
    chunks: chunks.map((chunk, position) => ({
      ...chunk,
      embedding: embeddings[position],
    })),
  };
}

async function loadVectorIndex() {
  if (!vectorIndexPromise) {
    vectorIndexPromise = buildVectorIndex();
  }

  return vectorIndexPromise;
}

async function retrieveContext(question, topK = 4) {
  const index = await loadVectorIndex();
  const [questionEmbedding] = await embedTexts([question], "search_query");

  return index.chunks
    .map((chunk) => ({
      ...chunk,
      score: cosineSimilarity(questionEmbedding, chunk.embedding),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK);
}

function formatContext(chunks) {
  return chunks
    .map((chunk, index) => {
      return `Source ${index + 1}: ${chunk.title}\n${chunk.text}`;
    })
    .join("\n\n");
}

function createChatMessages(context, question) {
  return [
    {
      role: "system",
      content:
        "You are Jayesh Somwanshi's portfolio assistant. Answer only from the provided portfolio context. If the context does not contain the answer, say that the portfolio does not include that information. Keep answers concise and useful for recruiters.",
    },
    {
      role: "user",
      content: `Portfolio context:\n${context}\n\nQuestion: ${question}`,
    },
  ];
}

function getStreamText(event) {
  return (
    event.delta?.message?.content?.text ||
    event.delta?.message?.content ||
    event.delta?.message ||
    ""
  );
}

async function parseBody(request) {
  if (request.body && typeof request.body === "object") {
    return request.body;
  }

  if (typeof request.body === "string") {
    return JSON.parse(request.body || "{}");
  }

  const buffers = [];
  for await (const chunk of request) {
    buffers.push(chunk);
  }

  const rawBody = Buffer.concat(buffers).toString("utf8");
  return JSON.parse(rawBody || "{}");
}

async function streamAnswer(question, response) {
  const chunks = await retrieveContext(question);
  const context = formatContext(chunks);
  const stream = await getCohereClient().chatStream({
    model: CHAT_MODEL,
    messages: createChatMessages(context, question),
  });

  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");

  for await (const event of stream) {
    if (event.type === "content-delta") {
      const text = getStreamText(event);
      if (text) {
        response.write(text);
      }
    }
  }

  response.end();
}

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }

  try {
    const body = await parseBody(request);
    const question = String(body?.message || "").trim();

    if (!question) {
      return response.status(400).json({ error: "Please send a message." });
    }

    await streamAnswer(question, response);
    return undefined;
  } catch (error) {
    console.error(error);

    if (response.headersSent) {
      response.write("\n\nUnable to answer right now.");
      response.end();
      return undefined;
    }

    return response.status(500).json({
      error: error.message || "Unable to answer right now.",
    });
  }
}
