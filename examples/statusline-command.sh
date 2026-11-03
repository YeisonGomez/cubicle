#!/usr/bin/env bash
# Statusline de Claude Code para la oficina: muestra solo el modelo (y el esfuerzo si
# Claude Code lo reporta). La carpeta y la rama ya se ven en la oficina. Los límites
# de uso de la cuenta (sesión de 5 h y semana) solo llegan a la statusline, así que
# se guardan en ~/.pixel-agents/usage.json para que la oficina los muestre arriba.
input=$(cat)

model=$(echo "$input" | jq -r '.model.display_name // empty')
# El esfuerzo llega como objeto ({"level": "high"}) o como texto; se muestra solo el nivel.
effort=$(echo "$input" | jq -r '(.effort // .reasoning_effort // .model.effort // empty) | if type == "object" then (.level // .value // empty) else . end')
ctx_day=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
ctx_week=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')

usage_file="$HOME/.pixel-agents/usage.json"
if [ -n "$ctx_day" ] || [ -n "$ctx_week" ]; then
  mkdir -p "$HOME/.pixel-agents" 2>/dev/null
  echo "$input" | jq -c --arg now "$(date +%s)" '{five_hour: (.rate_limits.five_hour // null), seven_day: (.rate_limits.seven_day // null), rate_limits: (.rate_limits // null), model: (.model.display_name // null), modelId: (.model.id // null), cost: (.cost // null), context_window: (.context_window // null), version: (.version // null), updatedAt: ($now | tonumber)}' > "$usage_file.tmp" 2>/dev/null && mv "$usage_file.tmp" "$usage_file"
fi

if [ -n "$model" ]; then
  if [ -n "$effort" ]; then
    printf "\033[36m🤖 %s\033[0m \033[90m· effort %s\033[0m\n" "$model" "$effort"
  else
    printf "\033[36m🤖 %s\033[0m\n" "$model"
  fi
fi
