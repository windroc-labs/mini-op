-- chord.applescript <modifier[,modifier]> <key code>: in the mini's Terminal, hold the modifiers, press
-- and release the key, release the modifiers last; only if Terminal is frontmost. AppleScript, not
-- JXA: JXA's keyDown sends nothing useful (README.md › Gotchas). Its caller, `mini chord`, checks the
-- arguments first.
on run argv
	if (count of argv) is not 2 then error "chord: usage: chord.applescript <modifier[,modifier]> <key code>"
	set AppleScript's text item delimiters to ","
	set mods to text items of (item 1 of argv)
	set AppleScript's text item delimiters to ""
	set keyNumber to (item 2 of argv) as integer
	-- every name maps to a modifier before any key goes down, so none is left held
	repeat with m in mods
		if {"command", "control", "option", "shift"} does not contain (m as text) then error "chord: unknown modifier " & m
	end repeat
	tell application "Terminal" to activate
	delay 0.6
	tell application "System Events"
		if name of first process whose frontmost is true is not "Terminal" then error "chord: Terminal not frontmost; sent nothing"
	end tell
	repeat with m in mods
		press(m as text, true)
	end repeat
	delay 0.2
	tell application "System Events" to key code keyNumber
	delay 0.2
	repeat with i from (count of mods) to 1 by -1
		press(item i of mods as text, false)
	end repeat
	return "chord: sent"
end run

-- Holds (down) or releases one modifier by name.
on press(modifier, down)
	tell application "System Events"
		if modifier is "command" then
			if down then
				key down command
			else
				key up command
			end if
		else if modifier is "control" then
			if down then
				key down control
			else
				key up control
			end if
		else if modifier is "option" then
			if down then
				key down option
			else
				key up option
			end if
		else
			if down then
				key down shift
			else
				key up shift
			end if
		end if
	end tell
end press
