"use client";

import { useState } from "react";
import { ActionItem, CallItem, ErrandItem } from "@/lib/types";

interface SidebarListsProps {
  actionItems: ActionItem[];
  callItems: CallItem[];
  errandItems: ErrandItem[];
}

type Tab = "todos" | "calls" | "errands";

export default function SidebarLists({ actionItems, callItems, errandItems }: SidebarListsProps) {
  const [activeTab, setActiveTab] = useState<Tab>("todos");

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: "todos", label: "To-Do", count: actionItems.filter((a) => !a.done).length },
    { key: "calls", label: "Calls", count: callItems.filter((c) => !c.done).length },
    { key: "errands", label: "Errands", count: errandItems.filter((e) => !e.done).length },
  ];

  return (
    <div className="bg-surface rounded-xl shadow-sm border border-border flex flex-col h-full">
      {/* Tab bar */}
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex-1 py-3 text-center text-sm font-medium transition-colors relative ${
              activeTab === tab.key
                ? "text-accent"
                : "text-muted hover:text-foreground"
            }`}
          >
            {tab.label}
            {tab.count > 0 && (
              <span className={`ml-1.5 inline-flex items-center justify-center w-5 h-5 text-[10px] font-bold rounded-full ${
                activeTab === tab.key ? "bg-accent text-white" : "bg-gray-200 text-gray-600"
              }`}>
                {tab.count}
              </span>
            )}
            {activeTab === tab.key && (
              <div className="absolute bottom-0 left-2 right-2 h-0.5 bg-accent rounded-full" />
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeTab === "todos" && <TodoList items={actionItems} />}
        {activeTab === "calls" && <CallList items={callItems} />}
        {activeTab === "errands" && <ErrandList items={errandItems} />}
      </div>
    </div>
  );
}

function TodoList({ items }: { items: ActionItem[] }) {
  const pending = items.filter((i) => !i.done);
  const done = items.filter((i) => i.done);

  return (
    <div className="space-y-1">
      {pending.map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100">
          <div className="w-5 h-5 mt-0.5 rounded border-2 border-gray-300 shrink-0 cursor-pointer hover:border-accent" />
          <div className="flex-1 min-w-0">
            <p className="text-sm leading-snug">{item.text}</p>
            <p className="text-[11px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
          {item.dueDate && (
            <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded shrink-0">
              due {new Date(item.dueDate + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
            </span>
          )}
        </div>
      ))}
      {done.length > 0 && (
        <>
          <div className="text-[10px] uppercase text-muted font-semibold tracking-wider px-2 pt-3 pb-1">
            Completed ({done.length})
          </div>
          {done.map((item) => (
            <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg opacity-50">
              <div className="w-5 h-5 mt-0.5 rounded border-2 border-accent bg-accent shrink-0 flex items-center justify-center">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="white" strokeWidth="2">
                  <path d="M2 5l2 2 4-4" />
                </svg>
              </div>
              <p className="text-sm leading-snug line-through text-muted">{item.text}</p>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function CallList({ items }: { items: CallItem[] }) {
  return (
    <div className="space-y-1">
      {items.filter((i) => !i.done).map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center shrink-0 text-sm">
            📞
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">{item.person}</p>
            <p className="text-xs text-muted mt-0.5">{item.reason}</p>
            <p className="text-[11px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

function ErrandList({ items }: { items: ErrandItem[] }) {
  return (
    <div className="space-y-1">
      {items.filter((i) => !i.done).map((item) => (
        <div key={item.id} className="flex items-start gap-2.5 p-2 rounded-lg hover:bg-gray-50 active:bg-gray-100">
          <div className="w-8 h-8 rounded-full bg-amber-100 flex items-center justify-center shrink-0 text-sm">
            📍
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm">{item.text}</p>
            {item.location && (
              <p className="text-xs text-muted mt-0.5 flex items-center gap-1">
                <span>@</span> {item.location}
              </p>
            )}
            <p className="text-[11px] text-muted mt-0.5 truncate">from: {item.source}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
