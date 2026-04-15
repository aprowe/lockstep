# Behavior Tests

---

## 1. Drop a matching marker file onto a loaded clip

**Given** a video is loaded (`concert.mp4`) with in-progress marker state  
**And** a sidecar file `concert.json` exists in the same folder with saved markers  
**When** the user drops `concert.json` onto the app window  
**Then** the video does not change
**And** all current in-memory markers are replaced with those from `concert.json`  

**Given** a sidecar file is loaded
**When** the user undos
**Then** the load is undone to the state directly before loading

**Given** a `.json` file is dropped with no sibling video next to it  
**When** the app tries to resolve the sibling  
**Then** the error is logged silently and the current state is unchanged  

**Given** a `.json` file is dropped whose sibling video differs from the currently loaded one  
**When** the sidecar is resolved  
**Then** the sibling video loads (replacing the current video) with its markers applied  

## 2. Video Loading
**When** a video is loaded, 
**Then** viewport will change to the length of the video  

## 3. Region Creation
**Given** a video is loaded and selected
**When** a new region is created from the timeline
**Then** It is created near the mouse with the smaller of: 10% of the current views time or 5 seconds

**Given** a video is loaded and selected
**When** a new region is created from the region list
**Then** It is created near the playhead with the smaller of: 10% of the current views time or 5 seconds
