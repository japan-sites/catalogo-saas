Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName Microsoft.VisualBasic

# =========================================
# CONFIG (lido de config.json)
# =========================================
$ConfigPath = Join-Path $PSScriptRoot "config.json"

if (-not (Test-Path $ConfigPath)) {
  [System.Windows.Forms.MessageBox]::Show(
    "Arquivo config.json não encontrado em:`n$ConfigPath",
    "Erro",
    "OK",
    "Error"
  ) | Out-Null
  exit 1
}

$config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
$ApiUrl   = $config.apiUrl
$FrontUrl = $config.frontUrl

# =========================================
# HELPERS
# =========================================
function MsgInfo($msg) {
  [System.Windows.Forms.MessageBox]::Show(
    $msg,
    "Atualizar Catálogo",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Information
  ) | Out-Null
}

function MsgErr($msg) {
  [System.Windows.Forms.MessageBox]::Show(
    $msg,
    "Erro",
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

function GetCatalogos {
  try {
    Invoke-RestMethod "$ApiUrl/catalogos"
  } catch {
    MsgErr "Não consegui acessar o backend:`n$ApiUrl`n`nVerifique se o backend está rodando."
    return @()
  }
}

# =========================================
# FORM PRINCIPAL
# =========================================
$form = New-Object System.Windows.Forms.Form
$form.Text = "Atualização de Catálogo e Produtos"
$form.Size = New-Object System.Drawing.Size(640, 320)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true

# ---------- Catálogo ----------
$lblCat = New-Object System.Windows.Forms.Label
$lblCat.Text = "Catálogo:"
$lblCat.Location = New-Object System.Drawing.Point(20, 20)
$lblCat.AutoSize = $true
$form.Controls.Add($lblCat)

$combo = New-Object System.Windows.Forms.ComboBox
$combo.Location = New-Object System.Drawing.Point(100, 16)
$combo.Size = New-Object System.Drawing.Size(420, 24)
$combo.DropDownStyle = "DropDownList"
$form.Controls.Add($combo)

$btnRefresh = New-Object System.Windows.Forms.Button
$btnRefresh.Text = "Atualizar"
$btnRefresh.Location = New-Object System.Drawing.Point(530, 15)
$form.Controls.Add($btnRefresh)

$lblPdf = New-Object System.Windows.Forms.Label
$lblPdf.Location = New-Object System.Drawing.Point(100, 45)
$lblPdf.Size = New-Object System.Drawing.Size(520, 30)
$form.Controls.Add($lblPdf)

# ---------- Modo ----------
$grpMode = New-Object System.Windows.Forms.GroupBox
$grpMode.Text = "Modo de Importação"
$grpMode.Location = New-Object System.Drawing.Point(20, 80)
$grpMode.Size = New-Object System.Drawing.Size(600, 60)
$form.Controls.Add($grpMode)

$rbReplace = New-Object System.Windows.Forms.RadioButton
$rbReplace.Text = "Replace (apaga e recria)"
$rbReplace.Location = New-Object System.Drawing.Point(15, 25)
$rbReplace.Checked = $true
$grpMode.Controls.Add($rbReplace)

$rbAppend = New-Object System.Windows.Forms.RadioButton
$rbAppend.Text = "Append (atualiza / insere)"
$rbAppend.Location = New-Object System.Drawing.Point(260, 25)
$grpMode.Controls.Add($rbAppend)

# ---------- CSV ----------
$lblCsv = New-Object System.Windows.Forms.Label
$lblCsv.Text = "Arquivo CSV:"
$lblCsv.Location = New-Object System.Drawing.Point(20, 155)
$form.Controls.Add($lblCsv)

$txtCsv = New-Object System.Windows.Forms.TextBox
$txtCsv.Location = New-Object System.Drawing.Point(100, 150)
$txtCsv.Size = New-Object System.Drawing.Size(420, 24)
$txtCsv.ReadOnly = $true
$form.Controls.Add($txtCsv)

$btnCsv = New-Object System.Windows.Forms.Button
$btnCsv.Text = "Selecionar"
$btnCsv.Location = New-Object System.Drawing.Point(530, 148)
$form.Controls.Add($btnCsv)

# ---------- Botões ----------
$btnCreate = New-Object System.Windows.Forms.Button
$btnCreate.Text = "Criar Catálogo"
$btnCreate.Location = New-Object System.Drawing.Point(20, 230)
$form.Controls.Add($btnCreate)

$btnImport = New-Object System.Windows.Forms.Button
$btnImport.Text = "Importar"
$btnImport.Location = New-Object System.Drawing.Point(420, 230)
$btnImport.Enabled = $false
$form.Controls.Add($btnImport)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = "Cancelar"
$btnCancel.Location = New-Object System.Drawing.Point(520, 230)
$form.Controls.Add($btnCancel)

# =========================================
# LÓGICA
# =========================================
$catalogos = @()

function LoadCatalogos {
  $combo.Items.Clear()
  $script:catalogos = GetCatalogos

  foreach ($c in $script:catalogos) {
    $label = "$($c.id) — $($c.nome)"
    if ($c.ano) { $label += " ($($c.ano))" }
    $combo.Items.Add($label) | Out-Null
  }

  if ($script:catalogos.Count -gt 0) {
    $combo.SelectedIndex = 0
  } else {
    $lblPdf.Text = ""
  }
}

LoadCatalogos

$combo.Add_SelectedIndexChanged({
  $i = $combo.SelectedIndex
  if ($i -ge 0) {
    $lblPdf.Text = "PDF: " + $catalogos[$i].pdf_url
  }
})

$btnRefresh.Add_Click({ LoadCatalogos })

$btnCsv.Add_Click({
  $dlg = New-Object System.Windows.Forms.OpenFileDialog
  $dlg.Filter = "Arquivos CSV (*.csv)|*.csv"
  $dlg.Title = "Selecione o arquivo CSV"
  if ($dlg.ShowDialog() -eq "OK") {
    $txtCsv.Text = $dlg.FileName
    $btnImport.Enabled = $true
  }
})

$btnCreate.Add_Click({
  $nome = [Microsoft.VisualBasic.Interaction]::InputBox("Nome do catálogo:", "Criar Catálogo")
  if (-not $nome) { return }

  $ano = [Microsoft.VisualBasic.Interaction]::InputBox("Ano (opcional):", "Criar Catálogo")
  $pdf = [Microsoft.VisualBasic.Interaction]::InputBox("URL do PDF:", "Criar Catálogo")

  if (-not $pdf) {
    MsgErr "PDF URL é obrigatório."
    return
  }

  $body = @{
    nome = $nome
    ano = if ($ano) { [int]$ano } else { $null }
    pdf_url = $pdf
  } | ConvertTo-Json -Depth 5

  try {
    Invoke-RestMethod "$ApiUrl/catalogos" -Method POST -ContentType "application/json" -Body $body
    MsgInfo "Catálogo criado com sucesso."
    LoadCatalogos
  } catch {
    MsgErr "Erro ao criar catálogo."
  }
})

$btnImport.Add_Click({
  $i = $combo.SelectedIndex
  if ($i -lt 0) {
    MsgErr "Selecione um catálogo."
    return
  }

  if (-not (Test-Path $txtCsv.Text)) {
    MsgErr "Arquivo CSV não encontrado."
    return
  }

  $catalogo = $catalogos[$i]
  $mode = if ($rbAppend.Checked) { "append" } else { "replace" }

  try {
    Start-Process curl.exe -ArgumentList @(
      "-s",
      "-X", "POST",
      "$ApiUrl/catalogos/$($catalogo.id)/importar?mode=$mode",
      "-F", "file=@$($txtCsv.Text)"
    ) -Wait -NoNewWindow

    Start-Process "$FrontUrl/c/$($catalogo.id)" | Out-Null
    $form.Close()
  } catch {
    MsgErr "Erro ao importar CSV."
  }
})

$btnCancel.Add_Click({ $form.Close() })

# =========================================
# START
# =========================================
[void]$form.ShowDialog()
