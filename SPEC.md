# Claude Recorder App Specification

## Overview
Claude Recorder is an iOS app for iPad that transforms daily voice recordings into organized, searchable client intelligence. It combines temporal organization (weekly calendar), contextual parsing (transcripts, photos, notes), and persistent client conversation logs to create a comprehensive record of professional interactions.

## Core Architecture

### 1. Data Flow
- **Input**: Voice recordings (imported as JSON transcripts from Claude)
- **Processing**: Automatic parsing for names, attendees, timestamps
- **Organization**: Temporal (calendar view) + Relational (client logs)
- **Output**: Curated context for voice chat with Claude; persistent client conversation history

### 2. Main UI Layout
The app uses a three-panel iPad layout:
- **Left Panel**: Client roster sidebar
- **Center Panel**: Weekly calendar view (vertical layout, Monday–Friday)
- **Right Panel**: Context viewer (toggles between multiple attribute views)

---

## Feature Details

### Calendar View (Center Panel)

#### Layout
- **Vertical layout**: Days stack top to bottom (Monday through Friday)
- **30-minute blocks**: Each recording import creates a block
- **Display**: Summarized title only on calendar blocks
- **Responsiveness**: Full summaries visible without truncation (advantage over column-based layout)

#### Import Mechanism
- Transcripts come from Claude in JSON format
- App recognizes JSON schema and auto-parses attributes
- Each transcript maps to a 30-minute calendar block
- Timestamps determine block placement

#### View Modes (Toggle)
1. **Granular View**: Individual 30-minute blocks for each recording
2. **Daily Summary View**: 
   - Rolls up all recordings for a single day into one summary
   - Uses Claude API to generate daily summaries on-demand
   - App tracks which days already have summaries (lazy loading)
   - Only calls Claude for unsummarized days
   - Caches results to avoid redundant API calls

### Context Viewer (Right Panel)

#### Dynamic Display
- Taps on a calendar block populate the viewer
- Viewer displays whichever attribute user selects
- Attribute options pulled directly from JSON schema

#### Viewer Tabs/Modes
- Full Transcript
- Summary
- To-Dos / Action Items
- Any other JSON attribute included in the transcript
- Photo viewer (shows images attached to that block)
- Supplemental notes (handwritten notes, screenshots)

### Client Roster (Left Panel)

#### Functionality
- Complete list of all clients and in-house contacts
- Filtering capability (filter calendar view by selected client)
- Reference point for auto-matching names in transcripts

#### Auto-Matching & Manual Override
- Claude parses recording for names and attendees
- App cross-references detected names against client list
- Auto-assigns transcript snippets to matching clients
- Manual override buttons allow user to correct or confirm assignments
- System learns from corrections over time

---

## Conversation Logs (Per-Client Persistent Record)

### Purpose
Build a long-term relationship history independent of calendar organization.

### Functionality
- Each client has a dedicated conversation thread
- Relevant transcript snippets automatically aggregate into client's thread
- Timeline spans days, weeks, months, even years
- Tracks:
  - What was discussed
  - Commitments made
  - Follow-ups required
  - Any other relevant details

### Data Persistence
- Snippets tagged with client name flow into their conversation log
- Logs remain accessible independently of calendar view
- Can search/browse client history without calendar filtering

---

## Photo & Document Integration

### Photo Import
- Photos captured during recording sessions import into app
- Photo metadata (timestamp) used as anchor point
- System automatically matches photos to recording blocks with overlapping timestamps
- Photos display alongside relevant transcript in viewer

### Supplemental Materials
- Handwritten notes (photographed)
- Screenshots
- Other documentation
- All snap in and attach to relevant transcript snippet
- Become part of snippet's full context

### Viewer Integration
- Photo viewer shows all images for a given recording block
- Images appear in context viewer alongside transcript
- Support for swiping through multiple images

---

## Gesture & Quick Actions

### Swipe Gestures (iOS Email-Style)
Implement swipe actions on calendar blocks for rapid triage:
- **Swipe left**: Delete (remove irrelevant recordings)
- **Swipe right**: Pin/Flag (mark as important)
- Additional swipe actions: Archive, mark for follow-up, etc.

### Purpose
Fast processing of high-volume daily imports without breaking focus or context.

---

## Voice Chat Integration

### Workflow
1. User selects and flags relevant snippets in calendar/viewer
2. Curated context builds from flagged items
3. User clicks "Voice Chat" button
4. App launches voice-mode conversation with Claude
5. Claude has access to curated context for informed responses
6. User can ask questions like: "What commitments do I have from last week?" or "What follow-ups are pending?"

### Data Isolation
- Voice chat conversations stored in separate silo
- Distinguished from raw source material (transcripts, photos, notes)
- User can reference chats but they don't pollute primary data

---

## JSON Transcript Schema

### Expected Format (from Claude)
Claude outputs transcripts in JSON with at least these fields:
```json
{
  "timestamp": "2026-04-03T14:30:00Z",
  "title": "Client meeting with John Smith",
  "fullTranscript": "...",
  "summary": "...",
  "todos": ["...", "..."],
  "attendees": ["John Smith", "Jane Doe"],
  "clientName": null,
  "customAttribute1": "...",
  "customAttribute2": "..."
}
```
