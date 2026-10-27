-- chord.applescript <modifier[,modifier]> <key code>: in the mini's Terminal, hold the modifiers, press
-- and release the key, release the modifiers last; only if Terminal is frontmost. AppleScript, not
-- JXA: JXA's keyDown sends nothing useful (README.md › Gotchas). Its caller, `mini chord`, checks the
-- arguments first. Every modifier pressed is released, on success or error.
-- chord.applescript --release <modifier[,modifier]>: key up for each named modifier, nothing else;
-- `mini chord` runs it after killing a chord, which never reached its own release.
-- osascript compiles this against the running macOS's terminology: handler and parameter names are
-- camelCase (no dictionary term is), calls go through `my`, and a script variable is read inside a
-- System Events tell only in a one-line `tell … to` (`key code keyNumber`). On macOS 27.2 the
-- plain-word handler `press(modifier, down)` failed with -1750.
on run argv
	if (count of argv) is not 2 then error "chord: usage: chord.applescript <modifier[,modifier]> <key code> | --release <modifier[,modifier]>"
	if item 1 of argv is "--release" then
		set failure to my releaseModifiers(my modifierList(item 2 of argv), missing value)
		if failure is not missing value then error (item 1 of failure) number (item 2 of failure)
		return "chord: released " & (item 2 of argv)
	end if
	set mods to my modifierList(item 1 of argv)
	set keyNumber to (item 2 of argv) as integer
	tell application "Terminal" to activate
	delay 0.6
	tell application "System Events"
		if (name of (first process whose frontmost is true)) is not "Terminal" then error "chord: Terminal not frontmost; sent nothing"
	end tell
	-- recorded before its key down, so a failed key down is released too (a key up of a free key is harmless)
	set pressed to {}
	set failure to missing value
	try
		repeat with m in mods
			set modName to m as text
			set end of pressed to modName
			my setModifier(modName, true)
		end repeat
		delay 0.2
		tell application "System Events" to key code keyNumber
		delay 0.2
	on error errText number errNumber
		set failure to {errText, errNumber}
	end try
	set failure to my releaseModifiers(pressed, failure)
	if failure is not missing value then error (item 1 of failure) number (item 2 of failure)
	return "chord: sent"
end run

-- The comma-separated names as a list; every name maps to a modifier before any key goes down or
-- up, so none is left held.
on modifierList(nameText)
	set AppleScript's text item delimiters to ","
	set mods to text items of nameText
	set AppleScript's text item delimiters to ""
	repeat with m in mods
		if {"command", "control", "option", "shift"} does not contain (m as text) then error "chord: unknown modifier " & m
	end repeat
	return mods
end modifierList

-- Releases the named modifiers, last first, trying every one; returns priorFailure, else the first
-- release error ({text, number}), else missing value.
on releaseModifiers(modifierNames, priorFailure)
	set failure to priorFailure
	repeat with i from (count of modifierNames) to 1 by -1
		try
			my setModifier((item i of modifierNames) as text, false)
		on error errText number errNumber
			if failure is missing value then set failure to {errText, errNumber}
		end try
	end repeat
	return failure
end releaseModifiers

-- Holds (isDown) or releases one modifier by name.
on setModifier(modifierName, isDown)
	if modifierName is "command" then
		if isDown then
			tell application "System Events" to key down command
		else
			tell application "System Events" to key up command
		end if
	else if modifierName is "control" then
		if isDown then
			tell application "System Events" to key down control
		else
			tell application "System Events" to key up control
		end if
	else if modifierName is "option" then
		if isDown then
			tell application "System Events" to key down option
		else
			tell application "System Events" to key up option
		end if
	else
		if isDown then
			tell application "System Events" to key down shift
		else
			tell application "System Events" to key up shift
		end if
	end if
end setModifier
