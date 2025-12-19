export const getISTDayRange = (date = new Date()) => {
  const istOffset = 5.5 * 60 * 60 * 1000;

  const istNow = new Date(date.getTime() + istOffset);

  // Midnight of current IST day
  const dayIST = new Date(
    istNow.getFullYear(),
    istNow.getMonth(),
    istNow.getDate()
  );

  // Convert that midnight IST back to UTC — this is your representative date
  const dayUTC = new Date(dayIST.getTime() - istOffset);

  return { dayUTC };
};

export const getProkeralaDateTime = (date = new Date()) => {
  const { dayUTC } = getISTDayRange(date);

  // Add offset to get back to IST midnight
  const istMidnight = new Date(dayUTC.getTime() + 5.5 * 60 * 60 * 1000);

  const yyyy = istMidnight.getFullYear();
  const mm = String(istMidnight.getMonth() + 1).padStart(2, "0");
  const dd = String(istMidnight.getDate()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T00:00:00+05:30`;
};