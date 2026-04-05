"use client";

import { useState } from "react";
import { Client, ClientKind, ContactSubtype, CONTACT_SUBTYPES } from "@/lib/types";
import { addClient, deleteClient } from "@/lib/clients";
import { getLastName } from "@/lib/utils";

interface ClientRosterProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (client: Client | null) => void;
  onClientsChange: () => void;
  transcriptCountByClient: Record<string, number>;
  mode?: "contacts" | "projects";
}

export default function ClientRoster({
  clients,
  selectedClientId,
  onSelectClient,
  onClientsChange,
  transcriptCountByClient,
  mode = "contacts",
}: ClientRosterProps) {
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newSubtype, setNewSubtype] = useState<ContactSubtype>("client");
  const [search, setSearch] = useState("");

  const sorted = [...clients].sort((a, b) => getLastName(a.name).localeCompare(getLastName(b.name)));
  const filtered = search
    ? sorted.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.company?.toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  function handleAdd() {
    if (!newName.trim()) return;
    if (mode === "projects") {
      addClient(newName.trim(), { kind: "project" });
    } else {
      addClient(newName.trim(), { company: newCompany.trim() || undefined, kind: "contact", contactSubtype: newSubtype });
    }
    setNewName("");
    setNewCompany("");
    setShowAdd(false);
    onClientsChange();
  }

  function handleDelete(id: string) {
    deleteClient(id);
    if (selectedClientId === id) onSelectClient(null);
    onClientsChange();
  }

  const isProjects = mode === "projects";

  // Group contacts by subtype
  const subtypeGroups = isProjects ? [] : CONTACT_SUBTYPES
    .map((st) => ({
      ...st,
      items: filtered.filter((c) => (c.contactSubtype || "client") === st.key),
    }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold">{isProjects ? "Projects" : "Contacts"}</h2>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-sm hover:bg-blue-600 active:scale-95"
          >
            +
          </button>
        </div>
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="shrink-0 px-3 py-2 border-b border-border bg-gray-50 space-y-1.5">
          <input
            type="text"
            placeholder={isProjects ? "Project name" : "Name"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {!isProjects && (
            <>
              <input
                type="text"
                placeholder="Company (optional)"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex gap-1 flex-wrap">
                {CONTACT_SUBTYPES.map((st) => (
                  <button
                    key={st.key}
                    onClick={() => setNewSubtype(st.key)}
                    className={`px-2 py-0.5 text-[10px] font-medium rounded ${
                      newSubtype === st.key ? "bg-accent text-white" : "bg-gray-200 text-muted"
                    }`}
                  >
                    {st.label}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowAdd(false)}
              className="flex-1 py-1.5 text-[10px] font-medium text-muted rounded border border-border hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              onClick={handleAdd}
              className="flex-1 py-1.5 text-[10px] font-medium bg-accent text-white rounded hover:bg-blue-600"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {/* "All" button */}
      <div className="shrink-0 px-2 pt-2">
        <button
          onClick={() => onSelectClient(null)}
          className={`w-full text-left px-2.5 py-2 rounded-lg text-xs font-medium transition-colors ${
            selectedClientId === null
              ? "bg-accent-light text-accent"
              : "text-foreground hover:bg-gray-50"
          }`}
        >
          {isProjects ? "All Projects" : "All Contacts"}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {isProjects ? (
          <>
            {filtered.length > 0 ? (
              filtered.map((project) => (
                <ClientRow
                  key={project.id}
                  client={project}
                  isSelected={selectedClientId === project.id}
                  count={transcriptCountByClient[project.id] || 0}
                  onSelect={() => onSelectClient(project)}
                  onDelete={project.id === "project-inbox" ? undefined : () => handleDelete(project.id)}
                  isProject
                />
              ))
            ) : (
              <div className="text-xs text-gray-300 text-center py-8">
                {search ? "No matches" : "No projects yet"}
              </div>
            )}
          </>
        ) : (
          <>
            {subtypeGroups.length > 0 ? (
              subtypeGroups.map((group) => (
                <div key={group.key}>
                  <div className="text-[9px] uppercase text-muted font-semibold tracking-wider px-2.5 pt-2.5 pb-1">
                    {group.label} ({group.items.length})
                  </div>
                  {group.items.map((client) => (
                    <ClientRow
                      key={client.id}
                      client={client}
                      isSelected={selectedClientId === client.id}
                      count={transcriptCountByClient[client.id] || 0}
                      onSelect={() => onSelectClient(client)}
                      onDelete={() => handleDelete(client.id)}
                    />
                  ))}
                </div>
              ))
            ) : (
              <div className="text-xs text-gray-300 text-center py-8">
                {search ? "No matches" : "No contacts yet"}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function ClientRow({
  client,
  isSelected,
  count,
  onSelect,
  onDelete,
  isProject,
}: {
  client: Client;
  isSelected: boolean;
  count: number;
  onSelect: () => void;
  onDelete?: () => void;
  isProject?: boolean;
}) {
  const subtypeColors: Record<ContactSubtype, string> = {
    client: "bg-blue-100 text-blue-700",
    rlm: "bg-purple-100 text-purple-700",
    supplier: "bg-orange-100 text-orange-700",
    family: "bg-pink-100 text-pink-700",
    other: "bg-gray-100 text-gray-600",
  };

  const avatarColor = isProject
    ? "bg-emerald-100 text-emerald-700"
    : subtypeColors[client.contactSubtype || "client"];

  return (
    <div
      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
        isSelected ? "bg-accent-light" : "hover:bg-gray-50"
      }`}
      onClick={onSelect}
    >
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor}`}>
        {isProject ? (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
          </svg>
        ) : (
          client.name.charAt(0).toUpperCase()
        )}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{isProject ? client.name : getLastName(client.name)}</div>
        {client.company && (
          <div className="text-[10px] text-muted truncate">{client.company}</div>
        )}
        {isProject && client.projectStatus && (
          <div className="text-[10px] text-muted truncate capitalize">{client.projectStatus.replace(/-/g, " ")}</div>
        )}
      </div>

      {/* Count badge */}
      {count > 0 && (
        <span className="text-[10px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full shrink-0">
          {count}
        </span>
      )}

      {/* Delete button */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="hidden group-hover:flex w-5 h-5 items-center justify-center text-gray-300 hover:text-red-500 shrink-0"
        >
          <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M5 5l10 10M15 5L5 15" />
          </svg>
        </button>
      )}
    </div>
  );
}
