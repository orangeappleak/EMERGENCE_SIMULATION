import http from "node:http";

const port = Number(process.env.EMERGENCE_AI_PORT ?? 8787);
const provider = process.env.AI_PROVIDER ?? "groq";
const model = process.env.AI_MODEL
  ?? (provider === "groq" ? "openai/gpt-oss-20b" : "gpt-4.1-mini");

const decisionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "observations", "memories", "goalNotes"],
  properties: {
    decision: {
      type: "object",
      additionalProperties: false,
      required: ["intention", "destinationId", "thought", "reason", "confidence", "expectedMinutes", "tags"],
      properties: {
        intention: { type: "string", enum: ["sleep", "home", "work", "school", "eat", "errand", "socialize", "wander", "recover"] },
        destinationId: { type: "string" },
        thought: { type: "string", minLength: 1, maxLength: 180 },
        reason: { type: "string", minLength: 1, maxLength: 240 },
        confidence: { type: "integer", minimum: 0, maximum: 100 },
        expectedMinutes: { type: "integer", minimum: 5, maximum: 240 },
        tags: {
          type: "array",
          maxItems: 8,
          items: { type: "string", maxLength: 32 },
        },
      },
    },
    observations: {
      type: "array",
      maxItems: 0,
      items: { type: "string" },
    },
    memories: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 180 },
    },
    goalNotes: {
      type: "array",
      maxItems: 3,
      items: { type: "string", maxLength: 180 },
    },
  },
};

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 180_000) {
        request.destroy();
        reject(new Error("Request body is too large."));
      }
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function sendJson(response, status, payload) {
  response.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  response.end(JSON.stringify(payload));
}

function sendText(response, status, text) {
  response.writeHead(status, {
    "Content-Type": "text/plain",
    "Access-Control-Allow-Origin": "http://localhost:5173",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  });
  response.end(text);
}

function extractOutputText(payload) {
  const chatContent = payload.choices?.[0]?.message?.content;
  if (typeof chatContent === "string") return chatContent;
  if (typeof payload.output_text === "string") return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (typeof content.text === "string") return content.text;
    }
  }
  return "";
}

function apiConfig() {
  if (provider === "groq") {
    return {
      apiKey: process.env.GROQ_API_KEY,
      url: "https://api.groq.com/openai/v1/chat/completions",
      missingKey: "GROQ_API_KEY is not set for the AI bridge server.",
      body: (context) => ({
        model,
        messages: [
          {
            role: "system",
            content: brainPrompt(),
          },
          {
            role: "user",
            content: JSON.stringify(compactContext(context)),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "citizen_brain_result",
            strict: true,
            schema: decisionSchema,
          },
        },
      }),
    };
  }

  return {
    apiKey: process.env.OPENAI_API_KEY,
    url: "https://api.openai.com/v1/responses",
    missingKey: "OPENAI_API_KEY is not set for the AI bridge server.",
    body: (context) => ({
      model,
      input: [
        {
          role: "system",
          content: [
            {
              type: "input_text",
              text: brainPrompt(),
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: JSON.stringify(compactContext(context)),
            },
          ],
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "citizen_brain_result",
          strict: true,
          schema: decisionSchema,
        },
      },
    }),
  };
}

function brainPrompt() {
  return [
    "You are one citizen brain inside a life simulation.",
    "Return only a JSON object that matches the schema.",
    "Choose exactly one action from availableActions by matching intention and destinationId.",
    "Do not invent world state, money, relationships, buildings, or civic facts.",
    "Children cannot choose errands or spending.",
    "Keep thoughts personal, grounded, and short.",
  ].join(" ");
}

function compactContext(context) {
  return {
    contract: context.contract,
    time: context.time,
    identity: context.identity,
    situation: context.situation,
    personality: context.personality,
    needs: context.needs,
    goals: context.goals?.slice(0, 4),
    household: context.household,
    progress: context.progress,
    availableActions: context.availableActions,
    relationships: context.relationships?.slice(0, 6),
    recentConversations: context.recentConversations?.slice(0, 5),
    recentMemories: context.recentMemories?.slice(0, 5),
    lifeJournal: context.lifeJournal?.slice(0, 5),
    localSignals: context.localSignals?.slice(0, 5),
    recentObservations: context.recentObservations?.slice(0, 5),
    constraints: context.constraints,
  };
}

async function createCitizenDecision(context) {
  const config = apiConfig();
  if (!config.apiKey) throw new Error(config.missingKey);

  const response = await fetch(config.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config.body(context)),
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error?.message ?? `${provider} request failed with ${response.status}`);
  }

  const outputText = extractOutputText(payload);
  if (!outputText) throw new Error(`${provider} returned no structured output text.`);
  return JSON.parse(outputText);
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "Access-Control-Allow-Origin": "http://localhost:5173",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    });
    response.end();
    return;
  }

  if (request.method !== "POST" || request.url !== "/api/ai/citizen-decision") {
    sendText(response, 404, "Not found");
    return;
  }

  try {
    const body = await readBody(request);
    const { context } = JSON.parse(body);
    if (!context?.identity?.id || !Array.isArray(context.availableActions)) {
      sendText(response, 400, "Invalid citizen brain context.");
      return;
    }
    const decision = await createCitizenDecision(context);
    sendJson(response, 200, decision);
  } catch (error) {
    sendText(response, 500, error instanceof Error ? error.message : "AI bridge failed.");
  }
});

server.listen(port, () => {
  console.log(`Emergence AI bridge listening on http://localhost:${port} using ${provider}:${model}`);
});
