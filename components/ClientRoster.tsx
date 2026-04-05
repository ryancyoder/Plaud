"use client";

import { useState } from "react";
import { Client, ClientKind } from "@/lib/types";
import { addClient, deleteClient } from "@/lib/clients";
import { getLastName } from "@/lib/utils";

type SubTab = "contacts" | "projects";

interface ClientRosterProps {
  clients: Client[];
  selectedClientId: string | null;
  onSelectClient: (client: Client | null) => void;
  onClientsChange: () => void;
  transcriptCountByClient: Record<string, number>;
}

export default function ClientRoster({
  clients,
  selectedClientId,
  onSelectClient,
  onClientsChange,
  transcriptCountByClient,
}: ClientRosterProps) {
  const [subTab, setSubTab] = useState<SubTab>("contacts");
  const [showAdd, setShowAdd] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newKind, setNewKind] = useState<ClientKind>("client");
  const [search, setSearch] = useState("");

  const sorted = [...clients].sort((a, b) => getLastName(a.name).localeCompare(getLastName(b.name)));
  const filtered = search
    ? sorted.filter(
        (c) =>
          c.name.toLowerCase().includes(search.toLowerCase()) ||
          c.company?.toLowerCase().includes(search.toLowerCase())
      )
    : sorted;

  const clientList = filtered.filter((c) => (c.kind || c.type) === "client");
  const contactList = filtered.filter((c) => (c.kind || c.type) === "contact");
  const projectList = filtered.filter((c) => c.kind === "project");

  function handleAdd() {
    if (!newName.trim()) return;
    const kind = subTab === "projects" ? "project" : newKind;
    addClient(newName.trim(), newCompany.trim() || undefined, kind);
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

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="shrink-0 px-3 py-2.5 border-b border-border">
        {/* Sub-tabs */}
        <div className="flex items-center gap-1 mb-2">
          <button
            onClick={() => setSubTab("contacts")}
            className={`flex-1 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
              subTab === "contacts" ? "bg-accent text-white" : "text-muted hover:bg-gray-100"
            }`}
          >
            Contacts
          </button>
          <button
            onClick={() => setSubTab("projects")}
            className={`flex-1 py-1 text-[10px] font-semibold rounded-lg transition-colors ${
              subTab === "projects" ? "bg-accent text-white" : "text-muted hover:bg-gray-100"
            }`}
          >
            Projects
          </button>
          <button
            onClick={() => setShowAdd(!showAdd)}
            className="w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center text-sm hover:bg-blue-600 active:scale-95 shrink-0"
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
            placeholder={subTab === "projects" ? "Project name" : "Name"}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
            className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
          />
          {subTab === "contacts" && (
            <>
              <input
                type="text"
                placeholder="Company (optional)"
                value={newCompany}
                onChange={(e) => setNewCompany(e.target.value)}
                className="w-full px-2.5 py-1.5 text-xs border border-border rounded-lg focus:outline-none focus:ring-1 focus:ring-accent"
              />
              <div className="flex gap-1.5">
                <button
                  onClick={() => setNewKind("client")}
                  className={`flex-1 py-1 text-[10px] font-medium rounded ${
                    newKind === "client" ? "bg-accent text-white" : "bg-gray-200 text-muted"
                  }`}
                >
                  Client
                </button>
                <button
                  onClick={() => setNewKind("contact")}
                  className={`flex-1 py-1 text-[10px] font-medium rounded ${
                    newKind === "contact" ? "bg-accent text-white" : "bg-gray-200 text-muted"
                  }`}
                >
                  Contact
                </button>
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
          {subTab === "contacts" ? "All Recordings" : "All Projects"}
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {subTab === "contacts" ? (
          <>
            {clientList.length > 0 && (
              <>
                <div className="text-[9px] uppercase text-muted font-semibold tracking-wider px-2.5 pt-2 pb-1">
                  Clients ({clientList.length})
                </div>
                {clientList.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    isSelected={selectedClientId === client.id}
                    count={transcriptCountByClient[client.id] || 0}
                    onSelect={() => onSelectClient(client)}
                    onDelete={() => handleDelete(client.id)}
                  />
                ))}
              </>
            )}

            {contactList.length > 0 && (
              <>
                <div className="text-[9px] uppercase text-muted font-semibold tracking-wider px-2.5 pt-3 pb-1">
                  Contacts ({contactList.length})
                </div>
                {contactList.map((client) => (
                  <ClientRow
                    key={client.id}
                    client={client}
                    isSelected={selectedClientId === client.id}
                    count={transcriptCountByClient[client.id] || 0}
                    onSelect={() => onSelectClient(client)}
                    onDelete={() => handleDelete(client.id)}
                  />
                ))}
              </>
            )}

            {clientList.length === 0 && contactList.length === 0 && (
              <div className="text-xs text-gray-300 text-center py-8">
                {search ? "No matches" : "No clients yet"}
              </div>
            )}
          </>
        ) : (
          <>
            {projectList.length > 0 ? (
              projectList.map((project) => (
                <ClientRow
                  key={project.id}
                  client={project}
                  isSelected={selectedClientId === project.id}
                  count={transcriptCountByClient[project.id] || 0}
                  onSelect={() => onSelectClient(project)}
                  onDelete={project.id === "project-inbox" ? undefined : () => handleDelete(project.id)}
                />
              ))
            ) : (
              <div className="text-xs text-gray-300 text-center py-8">
                {search ? "No matches" : "No projects yet"}
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
}: {
  client: Client;
  isSelected: boolean;
  count: number;
  onSelect: () => void;
  onDelete?: () => void;
}) {
  const kind = client.kind || client.type;
  const avatarColor = kind === "project"
    ? "bg-emerald-100 text-emerald-700"
    : kind === "client"
    ? "bg-blue-100 text-blue-700"
    : "bg-gray-100 text-gray-600";

  const avatarIcon = kind === "project" ? (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  ) : null;

  return (
    <div
      className={`group flex items-center gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-colors ${
        isSelected ? "bg-accent-light" : "hover:bg-gray-50"
      }`}
      onClick={onSelect}
    >
      {/* Avatar */}
      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0 ${avatarColor}`}>
        {avatarIcon || client.name.charAt(0).toUpperCase()}
      </div>

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium truncate">{kind === "project" ? client.name : getLastName(client.name)}</div>
        {client.company && (
          <div className="text-[10px] text-muted truncate">{client.company}</div>
        )}
        {kind === "project" && client.projectStatus && (
          <div className="text-[10px] text-muted truncate capitalize">{client.projectStatus.replace("-", " ")}</div>
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
