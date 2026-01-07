import "./App.css";
import React, { useMemo, useState } from "react";

const ENDPOINTS = {
  upload: process.env.REACT_APP_UPLOAD_URL,
  create: process.env.REACT_APP_CREATE_URL,
  get: process.env.REACT_APP_GET_URL,
  update: process.env.REACT_APP_UPDATE_URL,
  del: process.env.REACT_APP_DELETE_URL,
};

function requireEndpoint(url, name) {
  if (!url) throw new Error(`Missing ${name} URL in .env`);
  return url;
}

function toIsoNow() {
  return new Date().toISOString();
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      const base64 = commaIdx >= 0 ? result.slice(commaIdx + 1) : result;
      resolve(base64);
    };
    reader.readAsDataURL(file);
  });
}

async function apiFetchAbsolute(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    throw new Error(
      (data && data.message) || text || `Request failed: ${res.status}`
    );
  }

  return data;
}

export default function App() {
  // ✅ ALL HOOKS MUST BE INSIDE HERE
  const [userId, setUserId] = useState("u12345");

  // Create form fields
  const [text, setText] = useState("");
  const [visibility, setVisibility] = useState("private");
  const [file, setFile] = useState(null);
  const [uploadedFileUrl, setUploadedFileUrl] = useState("");
  const [uploadedBlobName, setUploadedBlobName] = useState("");

  // Entries
  const [entries, setEntries] = useState([]);
  const [loadingEntries, setLoadingEntries] = useState(false);

  // Editing
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState("");
  const [editVisibility, setEditVisibility] = useState("private");

  // Status
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  // AI Assistant (mock)
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantMessages, setAssistantMessages] = useState([
    {
      role: "assistant",
      text: "Hi — I’m your journaling assistant. Tell me how you’re feeling, or paste a journal entry and I’ll help you reflect.",
    },
  ]);

  // ✅ Insights (Mood) state
  const [mood, setMood] = useState(3); // 1–5
  const [moodNotes, setMoodNotes] = useState("");
  const [moodHistory, setMoodHistory] = useState([]); // [{ date, mood, notes }]

  const canUpload = useMemo(() => !!userId && !!file, [userId, file]);

  function clearMessages() {
    setStatus("");
    setError("");
  }

  async function handleUpload() {
    clearMessages();
    if (!canUpload) return;

    try {
      setStatus("Uploading file to Blob via Logic App...");
      const base64 = await readFileAsBase64(file);

      const payload = {
        userId,
        filename: file.name,
        filetype: file.type || "application/octet-stream",
        fileBase64: base64,
      };

      const result = await apiFetchAbsolute(
        requireEndpoint(ENDPOINTS.upload, "REACT_APP_UPLOAD_URL"),
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      setUploadedBlobName(result.blobName || "");
      setUploadedFileUrl(result.fileUrl || "");
      setStatus("Upload complete ✅");
    } catch (e) {
      setError(e.message);
      setStatus("");
    }
  }

  async function handleCreateEntry() {
    clearMessages();
    try {
      if (!userId) throw new Error("userId is required");
      if (!text.trim()) throw new Error("Journal text is required");

      setStatus("Creating journal entry in Cosmos DB...");

      const payload = {
        userId,
        text: text.trim(),
        visibility,
        uploadDate: toIsoNow(),

        // 👇 OPTIONAL media fields (only if uploadedFileUrl exists)
        ...(uploadedFileUrl
          ? {
              filename: file?.name || "",
              filetype: file?.type || "",
              fileUrl: uploadedFileUrl,
            }
          : {}),
      };

      await apiFetchAbsolute(
        requireEndpoint(ENDPOINTS.create, "REACT_APP_CREATE_URL"),
        {
          method: "POST",
          body: JSON.stringify(payload),
        }
      );

      setStatus("Entry created ✅");
      setText("");

      // Only clear file+upload state if we actually used an uploaded file
      if (uploadedFileUrl) {
        setFile(null);
        setUploadedFileUrl("");
        setUploadedBlobName("");
      }

      await handleLoadEntries();
    } catch (e) {
      setError(e.message);
      setStatus("");
    }
  }
async function handleLoadEntries() {
  clearMessages();
  try {
    if (!userId) throw new Error("userId is required");
    setLoadingEntries(true);
    setStatus("Loading entries...");

    const data = await apiFetchAbsolute(
      requireEndpoint(ENDPOINTS.get, "REACT_APP_GET_URL"),
      {
        method: "POST",
        body: JSON.stringify({ userId }),
      }
    );

    // Depending on your Logic App output shape:
    const list = Array.isArray(data) ? data : data?.entries || data?.value || [];
    setEntries(list);

    setStatus("Entries loaded ✅");
  } catch (e) {
    setError(e.message);
    setStatus("");
  } finally {
    setLoadingEntries(false);
  }
}

  
  function startEdit(entry) {
    setEditingId(entry.id);
    setEditText(entry.text || "");
    setEditVisibility(entry.visibility || "private");
  }

  function cancelEdit() {
    setEditingId(null);
    setEditText("");
    setEditVisibility("private");
  }

  async function handleUpdate(entryId) {
  clearMessages();
  try {
    if (!entryId) throw new Error("Missing entryId");
    setStatus("Updating entry...");

    const url = requireEndpoint(ENDPOINTS.update, "REACT_APP_UPDATE_URL");

    const payload = {
      id: entryId,            // <-- your Logic App might expect "id"
      entryId: entryId,       // <-- some setups expect "entryId" instead
      text: editText,
      visibility: editVisibility,
    };

    await apiFetchAbsolute(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setStatus("Entry updated ✅");
    cancelEdit();
    await handleLoadEntries();
  } catch (e) {
    setError(e.message || String(e));
    setStatus("");
  }
}

  async function handleDelete(entryId) {
  clearMessages();
  try {
    if (!entryId) throw new Error("Missing entryId");
    setStatus("Deleting entry...");

    const url = requireEndpoint(ENDPOINTS.del, "REACT_APP_DELETE_URL");

    const payload = {
      id: entryId,
      entryId: entryId,
    };

    await apiFetchAbsolute(url, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    setStatus("Entry deleted ✅");
    await handleLoadEntries();
  } catch (e) {
    setError(e.message || String(e));
    setStatus("");
  }
}

  function addMoodEntry() {
    const item = { date: toIsoNow(), mood, notes: moodNotes.trim() };
    setMoodHistory((prev) => [item, ...prev].slice(0, 14));
    setMoodNotes("");
  }

  function buildMockReply({ mood, userText, lastEntryText }) {
    const moodLabel = mood <= 2 ? "low" : mood === 3 ? "neutral" : "good";

    const grounding =
      "Try this quick reset: inhale 4s, hold 4s, exhale 6s — repeat 3 times.";

    const promptsByMood = {
      low: [
        "That sounds heavy. What’s one small thing that feels manageable right now?",
        "If a friend felt this way, what would you say to them?",
        grounding,
      ],
      neutral: [
        "What do you think triggered that feeling today?",
        "What’s one thing you want to carry forward from today — and one thing to release?",
        grounding,
      ],
      good: [
        "That’s a positive moment — what helped you get here?",
        "How can you make it easier to feel this way again tomorrow?",
        "Would you like to set a small intention for the next 24 hours?",
      ],
    };

    const suggestions = promptsByMood[moodLabel];

    const contextBit = lastEntryText
      ? `I also noticed your recent entry mentions: “${lastEntryText.slice(0, 120)}${
          lastEntryText.length > 120 ? "…" : ""
        }”`
      : "";

    return [
      `Thanks for sharing. Based on your mood (${mood}/5), here are a few gentle reflections:`,
      ...suggestions.map((s, i) => `${i + 1}. ${s}`),
      contextBit,
      userText
        ? `If you want, tell me more about: “${userText.slice(0, 120)}${
            userText.length > 120 ? "…" : ""
          }”`
        : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function handleAssistantSend() {
    const t = assistantInput.trim();
    if (!t) return;

    const lastEntryText = entries?.[0]?.text || "";

    setAssistantMessages((prev) => [...prev, { role: "user", text: t }]);
    setAssistantInput("");

    setTimeout(() => {
      const reply = buildMockReply({ mood, userText: t, lastEntryText });
      setAssistantMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    }, 400);
  }

  return (
    <div className="container">
      <h1>Mental Health Journal</h1>
      <p className="subtitle">
        CW2 Demo 
      </p>

      <div className="card">
        <label>User ID</label>
        <input
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          placeholder="e.g. u12345"
        />
      </div>

      {(status || error) && (
        <div>
          {status && <div className="status success">{status}</div>}
          {error && <div className="status error">Error: {error}</div>}
        </div>
      )}

      {/* CREATE + ENTRIES GRID */}
      <div className="grid-2">
        {/* CREATE */}
        <section className="card">
          <h2>Create entry</h2>
          <p className="subtitle">
            Upload a file first (optional), then create the metadata record.
          </p>

          <label>Journal text</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={5}
            placeholder="Write your journal entry..."
          />

          <label>Visibility</label>
          <select value={visibility} onChange={(e) => setVisibility(e.target.value)}>
            <option value="private">private</option>
            <option value="public">public</option>
          </select>

          <label>Media file (optional)</label>
          <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} />

          <div className="actions">
            <button onClick={handleUpload} disabled={!userId || !file} className="secondary">
              Upload file
            </button>

            <button
              onClick={handleCreateEntry}
              disabled={!userId || !text.trim()}
              className="primary"
              title={!userId || !text.trim() ? "Enter text and user ID" : "Create entry"}
            >
              Create entry
            </button>
          </div>

          <div className="status" style={{ marginTop: 12 }}>
            <strong>Upload status:</strong> {uploadedFileUrl ? "Ready ✅" : "Not uploaded"}

            {uploadedBlobName && (
              <div style={{ marginTop: 6 }}>
                <strong>Blob:</strong> {uploadedBlobName}
              </div>
            )}

            {uploadedFileUrl && (
              <div style={{ marginTop: 6 }}>
                <a href={uploadedFileUrl} target="_blank" rel="noreferrer">
                  Open uploaded media ↗
                </a>
              </div>
            )}
          </div>
        </section>

        {/* ENTRIES + INSIGHTS */}
        <section className="card">
          <h2>Entries</h2>
          <p className="subtitle">Load, edit, and delete entries for the current user.</p>

          <button
            onClick={handleLoadEntries}
            disabled={!userId || loadingEntries}
            className="secondary"
          >
            {loadingEntries ? "Loading..." : "Load entries"}
          </button>

          {entries.length === 0 ? (
            <p style={{ marginTop: 12, color: "#6b7280" }}>No entries loaded yet.</p>
          ) : (
            entries.map((entry) => (
              <div key={entry.id} className="entry">
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: "0.85rem", color: "#6b7280" }}>Entry ID</div>
                    <div style={{ fontWeight: 600 }}>{entry.id}</div>
                  </div>

                  <div style={{ display: "flex", gap: 8 }}>
                    <button onClick={() => startEdit(entry)} className="secondary">
                      Edit
                    </button>
                    <button onClick={() => handleDelete(entry.id)} className="danger">
                      Delete
                    </button>
                  </div>
                </div>

                {editingId === entry.id ? (
                  <div style={{ marginTop: 12 }}>
                    <label>Edit text</label>
                    <textarea
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      rows={4}
                    />

                    <label>Edit visibility</label>
                    <select
                      value={editVisibility}
                      onChange={(e) => setEditVisibility(e.target.value)}
                    >
                      <option value="private">private</option>
                      <option value="public">public</option>
                    </select>

                    <div className="actions">
                      <button onClick={() => handleUpdate(entry.id)} className="primary">
                        Save
                      </button>
                      <button onClick={cancelEdit} className="secondary">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ marginTop: 12 }}>{entry.text}</p>
                )}

                {entry.fileUrl && (
                  <div style={{ marginTop: 10 }}>
                    <a href={entry.fileUrl} target="_blank" rel="noreferrer">
                      Open media ↗
                    </a>
                  </div>
                )}
              </div>
            ))
          )}

          {/* INSIGHTS (under Entries) */}
          <div style={{ marginTop: 24 }}>
            <h2>Insights</h2>
            <p className="subtitle">Quick mood tracking (local only for now).</p>

            <label>Today's mood (1–5)</label>
            <input
              type="range"
              min="1"
              max="5"
              value={mood}
              onChange={(e) => setMood(Number(e.target.value))}
            />
            <div style={{ marginTop: 6, fontWeight: 600 }}>Mood: {mood} / 5</div>

            <label style={{ marginTop: 12 }}>Notes (optional)</label>
            <textarea
              value={moodNotes}
              onChange={(e) => setMoodNotes(e.target.value)}
              rows={3}
              placeholder="Anything you'd like to remember about today..."
            />

            <div className="actions">
              <button onClick={addMoodEntry} className="primary">
                Save mood
              </button>
            </div>

            {moodHistory.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Recent moods</div>
                <div style={{ display: "grid", gap: 8 }}>
                  {moodHistory.map((m, idx) => (
                    <div key={idx} className="entry">
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          gap: 10,
                        }}
                      >
                        <div style={{ color: "#6b7280", fontSize: "0.9rem" }}>
                          {new Date(m.date).toLocaleString()}
                        </div>
                        <div style={{ fontWeight: 700 }}>Mood: {m.mood}/5</div>
                      </div>
                      {m.notes && <div style={{ marginTop: 8 }}>{m.notes}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* AI ASSISTANT */}
      <section className="card" style={{ marginTop: 24 }}>
        <h2>AI Assistant (Mock)</h2>
        <p className="subtitle">
          Local/mock assistant for now — can be replaced with Azure OpenAI when your deployment
          works.
        </p>

        <div
          style={{
            border: "1px solid #e5e7eb",
            borderRadius: "12px",
            padding: "12px",
            height: "220px",
            overflowY: "auto",
            background: "#fafafa",
          }}
        >
          {assistantMessages.map((m, idx) => (
            <div key={idx} style={{ marginBottom: 10 }}>
              <div style={{ fontSize: "0.8rem", color: "#6b7280" }}>
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div style={{ whiteSpace: "pre-wrap" }}>{m.text}</div>
            </div>
          ))}
        </div>

        <label style={{ marginTop: 12 }}>Message</label>
        <textarea
          value={assistantInput}
          onChange={(e) => setAssistantInput(e.target.value)}
          rows={3}
          placeholder="Ask for reflection, a coping strategy, or a summary…"
        />

        <div className="actions">
          <button className="primary" onClick={handleAssistantSend}>
            Send
          </button>
          <button
            className="secondary"
            onClick={() =>
              setAssistantMessages([
                {
                  role: "assistant",
                  text: "Hi — I’m your journaling assistant. Tell me how you’re feeling, or paste a journal entry and I’ll help you reflect.",
                },
              ])
            }
          >
            Clear
          </button>
        </div>
      </section>

      <p style={{ textAlign: "center", color: "#6b7280", marginTop: 20 }}>
        CW2 — Blob Storage + Cosmos DB + Logic Apps CRUD
      </p>
    </div>
  );
}
