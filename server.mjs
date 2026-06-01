import "dotenv/config";
import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CohereClientV2 } from "cohere-ai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3005;
const HOST = process.env.HOST || "127.0.0.1";
const CHAT_MODEL = process.env.COHERE_MODEL || "command-a-03-2025";
const EMBEDDING_MODEL = process.env.COHERE_EMBEDDING_MODEL || "embed-v4.0";
const KNOWLEDGE_FILE = path.join(__dirname, "data", "portfolio.md");
const VECTOR_DIR = path.join(__dirname, ".rag");
const VECTOR_FILE = path.join(VECTOR_DIR, "portfolio-index.json");

let cohere;

function assertCohereApiKey() {
  if (!process.env.COHERE_API_KEY) {
    throw new Error("Missing COHERE_API_KEY. Add your Cohere key to .env.");
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
  const indexedAt = new Date().toISOString();

  const index = {
    indexedAt,
    source: path.relative(__dirname, KNOWLEDGE_FILE),
    embeddingModel: EMBEDDING_MODEL,
    chunks: chunks.map((chunk, position) => ({
      ...chunk,
      embedding: embeddings[position],
    })),
  };

  await fs.mkdir(VECTOR_DIR, { recursive: true });
  await fs.writeFile(VECTOR_FILE, JSON.stringify(index, null, 2));
  return index;
}

async function loadVectorIndex() {
  try {
    const raw = await fs.readFile(VECTOR_FILE, "utf8");
    const index = JSON.parse(raw);

    if (index.embeddingModel !== EMBEDDING_MODEL) {
      return buildVectorIndex();
    }

    return index;
  } catch (error) {
    return buildVectorIndex();
  }
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

async function streamAnswer(question, response) {
  const chunks = await retrieveContext(question);
  const context = formatContext(chunks);
  const stream = await getCohereClient().chatStream({
    model: CHAT_MODEL,
    messages: createChatMessages(context, question),
  });

  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();

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

async function answerQuestion(question) {
  const chunks = await retrieveContext(question);
  const context = formatContext(chunks);

  const cohereResponse = await getCohereClient().chat({
    model: CHAT_MODEL,
    messages: createChatMessages(context, question),
  });
  const answer =
    cohereResponse.message?.content
      ?.filter((item) => item.type === "text")
      .map((item) => item.text)
      .join("")
      .trim() || "No answer returned.";

  return {
    answer,
    sources: chunks.map((chunk) => ({
      title: chunk.title,
      score: Number(chunk.score.toFixed(4)),
    })),
  };
}

if (process.argv.includes("--ingest")) {
  const index = await buildVectorIndex();
  console.log(`Indexed ${index.chunks.length} chunks from ${index.source}`);
  process.exit(0);
}

const app = express();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(__dirname));

app.get("/", (request, response) => {
  response.sendFile(path.join(__dirname, "index.html"));
});

app.post("/api/chat", async (request, response) => {
  try {
    const question = String(request.body?.message || "").trim();

    if (!question) {
      return response.status(400).json({ error: "Please send a message." });
    }

    if (request.headers.accept?.includes("text/plain")) {
      await streamAnswer(question, response);
      return undefined;
    }

    return response.json(await answerQuestion(question));
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
});

app.use((error, request, response, next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return response.status(400).json({ error: "Request body must be valid JSON." });
  }

  return next(error);
});

app.listen(PORT, HOST, () => {
  console.log(`Portfolio AI server running at http://${HOST}:${PORT}`);
});
