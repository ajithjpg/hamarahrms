// src/utils/seedData.js
// Run with: node src/utils/seedData.js
// Creates demo users, courses, and attendance records for testing

require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });

const {
  sequelize, User, Attendance, LeaveBalance,
  TrainingCourse, Leave, Payroll,
} = require('../models');
const bcrypt = require('bcryptjs');

const seed = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync({ force: true }); // ⚠️ Drops and recreates all tables
    console.log('✅ Database synced');

    // ─── Users ────────────────────────────────────────────────────────────────
    const hashedPw = await bcrypt.hash('Password@123', 12);

    const admin = await User.create({
      employeeId: 'EMP001', firstName: 'Arjun', lastName: 'Sharma',
      email: 'admin@hamarahr.com', password: hashedPw, role: 'admin',
      department: 'IT', designation: 'System Administrator',
      phone: '9876543210', dateOfJoining: '2022-01-01', basicSalary: 80000,
    });

    const hr = await User.create({
      employeeId: 'EMP002', firstName: 'Priya', lastName: 'Mehta',
      email: 'hr@hamarahr.com', password: hashedPw, role: 'hr',
      department: 'Human Resources', designation: 'HR Manager',
      phone: '9876543211', dateOfJoining: '2022-03-15', basicSalary: 60000,
    });

    const manager = await User.create({
      employeeId: 'EMP003', firstName: 'Rohan', lastName: 'Verma',
      email: 'manager@hamarahr.com', password: hashedPw, role: 'manager',
      department: 'Engineering', designation: 'Engineering Manager',
      phone: '9876543212', dateOfJoining: '2021-06-01', basicSalary: 100000,
    });

    const emp1 = await User.create({
      employeeId: 'EMP004', firstName: 'Sneha', lastName: 'Patel',
      email: 'employee@hamarahr.com', password: hashedPw, role: 'employee',
      department: 'Engineering', designation: 'Software Engineer',
      phone: '9876543213', dateOfJoining: '2023-01-10',
      managerId: manager.id, basicSalary: 50000, pan: 'ABCDE1234F',
    });

    const emp2 = await User.create({
      employeeId: 'EMP005', firstName: 'Vikram', lastName: 'Nair',
      email: 'vikram@hamarahr.com', password: hashedPw, role: 'employee',
      department: 'Engineering', designation: 'Senior Developer',
      phone: '9876543214', dateOfJoining: '2022-07-20',
      managerId: manager.id, basicSalary: 70000,
    });

    console.log('✅ Users created');

    // ─── Leave Balances ───────────────────────────────────────────────────────
    const year = new Date().getFullYear();
    for (const u of [admin, hr, manager, emp1, emp2]) {
      await LeaveBalance.create({ userId: u.id, year });
    }
    console.log('✅ Leave balances created');

    // ─── Attendance (last 30 days) ────────────────────────────────────────────
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const dayOfWeek = d.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

      for (const emp of [emp1, emp2]) {
        const punchIn = new Date(d);
        punchIn.setHours(9, Math.random() > 0.3 ? 5 : 25, 0, 0);
        const punchOut = new Date(d);
        // Vikram works late occasionally (burnout risk)
        const extraHours = emp.id === emp2.id && Math.random() > 0.5 ? 2 : 0;
        punchOut.setHours(18 + extraHours, 0, 0, 0);

        const diffMs = punchOut - punchIn;
        const totalHours = parseFloat((diffMs / 3600000).toFixed(2));
        const overtimeHours = parseFloat(Math.max(0, totalHours - 9).toFixed(2));

        await Attendance.create({
          userId: emp.id,
          date: dateStr,
          punchIn: isWeekend ? null : punchIn,
          punchOut: isWeekend ? null : punchOut,
          punchInLat: 12.9716, punchInLng: 77.5946,
          punchOutLat: 12.9716, punchOutLng: 77.5946,
          totalHours: isWeekend ? 0 : totalHours,
          overtimeHours: isWeekend ? 0 : overtimeHours,
          status: isWeekend ? 'weekend' : 'present',
          isWeekend,
        });
      }
    }
    console.log('✅ Attendance records created');

    // ─── Training Courses ─────────────────────────────────────────────────────
    const courses = [
      { title: 'Introduction to POSH Act 2013', description: 'Prevention of Sexual Harassment at Workplace', category: 'Compliance', duration: 45, xpReward: 150, badgeName: 'Compliance Champion', createdBy: hr.id },
      { title: 'Advanced Excel for HR Analytics', description: 'Pivot tables, VLOOKUP, dashboards for HR data', category: 'Technical', duration: 120, xpReward: 250, badgeName: 'Excel Expert', createdBy: hr.id },
      { title: 'Effective Communication Skills', description: 'Email writing, presentation, and meeting management', category: 'Soft Skills', duration: 60, xpReward: 200, badgeName: 'Communicator', createdBy: hr.id },
      { title: 'Leadership Fundamentals', description: 'Core leadership principles for new managers', category: 'Leadership', duration: 90, xpReward: 300, badgeName: 'Leader', createdBy: hr.id },
      { title: 'Data Privacy & DPDP Act 2023', description: 'India\'s Digital Personal Data Protection Act compliance', category: 'Compliance', duration: 30, xpReward: 100, badgeName: 'Privacy Pro', createdBy: hr.id },
    ];
    for (const c of courses) await TrainingCourse.create(c);
    console.log('✅ Training courses created');

    console.log('\n🎉 Seed complete!\n');
    console.log('Demo Credentials:');
    console.log('  Admin:    admin@hamarahr.com    / Password@123');
    console.log('  HR:       hr@hamarahr.com       / Password@123');
    console.log('  Manager:  manager@hamarahr.com  / Password@123');
    console.log('  Employee: employee@hamarahr.com / Password@123\n');

    process.exit(0);
  } catch (err) {
    console.error('❌ Seed failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  }
};

seed();
