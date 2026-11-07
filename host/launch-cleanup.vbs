Option Explicit

If WScript.Arguments.Count < 3 Then WScript.Quit 1
Dim fso, cleaner, command, status
Set fso = CreateObject("Scripting.FileSystemObject")
cleaner = fso.BuildPath(fso.GetParentFolderName(WScript.ScriptFullName), "clean-map-assets.cjs")
command = Quote(WScript.Arguments(0)) & " " & Quote(cleaner) & " " & Quote(WScript.Arguments(1)) & " " & Quote(WScript.Arguments(2)) & " --prompt"
status = CreateObject("WScript.Shell").Run(command, 0, True)
WScript.Quit status

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
