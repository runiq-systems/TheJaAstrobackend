export const getStartOfISTDay = (date = new Date()) => {
  const istOffset = 5.5 * 60 * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffset);

  return new Date(
    istDate.getFullYear(),
    istDate.getMonth(),
    istDate.getDate()
  );
};

export const getProkeralaDateTime = (date = new Date()) => {
  const d = getStartOfISTDay(date);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T00:00:00+05:30`;
};
