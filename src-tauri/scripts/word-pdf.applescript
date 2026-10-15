-- usage: osascript word-pdf.applescript <input.docx> <output.pdf>
-- Exports a .docx to PDF with Microsoft Word's own "Save As PDF". Both paths should be inside
-- Word's sandbox container (~/Library/Containers/com.microsoft.Word/Data/...) so Word never
-- asks for file access.
on run argv
	set inPath to item 1 of argv
	set outPath to item 2 of argv
	set wasRunning to application "Microsoft Word" is running
	tell application "Microsoft Word"
		with timeout of 600 seconds
			set display alerts to alerts none
			open file name inPath with read only without add to recent files
			set d to active document
			set n to name of d
			save as d file name outPath file format format PDF add to recent files false
			close document n saving no
			if not wasRunning and (count of documents) is 0 then quit saving no
		end timeout
	end tell
	return outPath
end run
