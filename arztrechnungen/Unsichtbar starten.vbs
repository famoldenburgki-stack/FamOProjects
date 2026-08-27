' Startet das uebergebene Skript ohne sichtbares Fenster.
' Aufruf:  wscript "Unsichtbar starten.vbs" "Arztrechnungen Dienst.cmd"
Set fso = CreateObject("Scripting.FileSystemObject")
ordner = fso.GetParentFolderName(WScript.ScriptFullName)

If WScript.Arguments.Count = 0 Then
  MsgBox "Kein Skript angegeben.", 16, "Arztrechnungen"
  WScript.Quit 1
End If

skript = fso.BuildPath(ordner, WScript.Arguments(0))
If Not fso.FileExists(skript) Then
  MsgBox "Nicht gefunden: " & skript, 16, "Arztrechnungen"
  WScript.Quit 1
End If

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = ordner
' 0 = kein Fenster, False = nicht auf das Ende warten
shell.Run """" & skript & """", 0, False
