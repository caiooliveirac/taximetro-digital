"use client";

import { useEffect } from "react";

export function ReportAutoPrint() {
  useEffect(() => {
    window.print();
  }, []);

  return null;
}