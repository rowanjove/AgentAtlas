Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = fso.BuildPath(scriptDir, "tray-launcher.ps1")

cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -STA -File """ & trayScript & """"
shell.Run cmd, 0, False
