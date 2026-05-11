
export const getIndianStyleDuration = (createdat, completedat) => {
  const createdAt = new Date(createdat);
  const completedAt = new Date(completedat);
  return completedAt - createdAt;
};

