"use client";

import React from "react";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";
import ClientLogBridge from "@/components/client-log-bridge";

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ClientLogBridge />
      <ToastContainer
        position="top-right"
        autoClose={2500}
        hideProgressBar={false}
        newestOnTop
        closeOnClick
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
      />
    </>
  );
}
