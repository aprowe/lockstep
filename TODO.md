

Export Dialog
- [x] Default to input file location, remember last changed path (persisted in Redux uiSlice)
- [x] Don't highlight the "Saved" button after its done (shows "Save" until clicked, disabled after)
- [ ] Button for setting path, but allow text input
- [ ] Add BPM to normalize to


Markers
- [x] Show number of markers selected (header shows "3/12" when 3 of 12 selected)
- [ ] Have BPM / beat count change the length of the region, but if the end is unlinked, just change the length of the Beat timeline 


Timeline
- [x] Selecting a region in the timeline should not change the view (removed setPendingZoom from region select)
- [ ] Need different highlight for when top vs bottom markers selected
- [ ] Selecting in between timelines should select on both timelines (lasso in WarpConnector)
- [ ] Nudge Context menu (modal) nudges markers by N frames (input field)


Regions
- [x] Detect / Tap BPM should be on the region level, so in the left panel (added ? button to RegionInfoPanel)

