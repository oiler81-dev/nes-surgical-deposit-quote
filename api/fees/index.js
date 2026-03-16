if (method === "POST" || method === "PUT") {
  const cpt = cleanCode(body.cpt);
  const description = cleanText(body.description);
  const allowed = cleanMoney(body.allowed);
  const active = cleanBool(body.active, true);

  if (!cpt) {
    return jsonResponse(context, { ok: false, error: "CPT is required." }, 400);
  }

  const now = new Date().toISOString();

  const entity = {
    PartitionKey: "CPT",
    RowKey: cpt,
    description: description,
    allowed: allowed,
    active: active,
    updatedBy: user.userDetails || "",
    updatedAt: now
  };

  await table.upsertEntity(entity);

  return jsonResponse(context, { ok: true });
}
